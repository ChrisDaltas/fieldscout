'use client'

import { useEffect, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Icon } from '@/components/ui/icon'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import {
  useConfirmRemix,
  useRemixPreview,
  type RemixConfirmResult,
  type RemixPreview,
  type ScheduleMatchup,
} from '@/hooks/use-schedule'
import { cn } from '@/lib/utils'

import { formatKickoff } from './lineup-editor'
import {
  confirmGate,
  diffByWeek,
  frozenWeekCopy,
  remixWindowCopy,
  sideBySide,
  systemPostPreview,
  type PairingCell,
} from './schedule-view-ops'
import { StatusBanner } from './status-banners'

/**
 * ScheduleRemixModal (§16.2 `schedule-remix-modal`: "regenerate (seeded) →
 * side-by-side diff → system-post preview → confirm"; §11.7 Remix; §16.4 —
 * M4 task L.D5.3; PROGRESS D289, D290, D307, D317).
 *
 * **The client sends a SEED, never a schedule.** Opening the modal mints a
 * seed (`useRemixPreview.preview`, entropy at the gesture) and previews it
 * write-free; "Roll again" mints another; Confirm sends THAT seed back and
 * 111 regenerates the season in its own body (`schedule-service.ts`'s law).
 * Nothing rendered here — the proposed grid, the diff, the frozen weeks —
 * is ever posted.
 *
 * **E41's two states, both rendered (D290).** The preview's `window` —
 * evaluated by 111 at transaction time from `nfl_games.kickoff_at` — picks
 * the copy: FREE (no reason) before the league's Week 1 kickoff, OVERRIDE
 * (reason REQUIRED, posted with the change) after it. The modal never
 * evaluates the window itself; `confirmGate` reads the flag.
 *
 * **Never optimistic.** A Remix rewrites the season: Confirm shows a
 * submitting state, a refusal renders the RPC's sentence VERBATIM
 * (`role="alert"`), and success renders the server's result — the weeks it
 * regenerated, the rows it replaced and the D97 system post EXACTLY as it
 * was written to league chat. The preview of that post, shown before
 * Confirm, is labelled a preview.
 *
 * Elevation: the dialog is a TRUE OVERLAY — `DialogContent` (ui/dialog.tsx)
 * carries the resting `shadow-hard-8`, with its reason beside it, and that
 * is the only resting shadow on this surface; nothing in this file adds one
 * (CLAUDE.md). Single theme; tokens only.
 */
export interface ScheduleRemixProps {
  leagueId: string
  /** The season as it stands (`useSchedule`'s matchups) — the left column. */
  current: readonly ScheduleMatchup[]
  teamNames: ReadonlyMap<string, string>
  leagueTimeZone: string | null
  /** For the system-post PREVIEW only; 111 names the actor itself. */
  actorName: string
}

export function ScheduleRemixModal({
  open,
  onOpenChange,
  ...panel
}: ScheduleRemixProps & {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  // The panel is mounted only while open, so its hooks and state (the seed,
  // the reason, a confirm's result) reset on every close — a fresh Remix is
  // a fresh roll. Radix's Portal renders nothing in a static render, which
  // is why the panel is its own export: the states pin renders it directly.
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl gap-3" data-remix-modal>
        {open && <ScheduleRemixPanel {...panel} onClose={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  )
}

/** The modal's whole content — header, the preview / applied / error /
 *  loading body, the footer. Exported for the states pin. */
export function ScheduleRemixPanel({
  leagueId,
  current,
  teamNames,
  leagueTimeZone,
  actorName,
  onClose,
}: ScheduleRemixProps & { onClose: () => void }) {
  const preview = useRemixPreview(leagueId)
  const confirm = useConfirmRemix(leagueId)
  const [reason, setReason] = useState('')

  // Opening previews at once — a Remix begins with a roll, not a form.
  useEffect(() => {
    preview.preview()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const close = () => {
    onClose()
  }

  const plan = preview.data ?? null
  const applied = confirm.data ?? null

  return (
    <>
      <DialogHeader>
        <DialogTitle>Remix schedule</DialogTitle>
        <DialogDescription>
          A new seed regenerates every week that can still change; live and final weeks stay.
          Nothing is written until you confirm.
        </DialogDescription>
      </DialogHeader>

      {applied ? (
        <AppliedPanel result={applied} />
      ) : preview.isPending || (!plan && !preview.isError) ? (
        <div className="flex flex-col gap-2" data-skeleton="remix-preview">
          <Skeleton className="h-10 rounded-sm" />
          <Skeleton className="h-40 rounded-sm" />
        </div>
      ) : preview.isError || !plan ? (
        <div className="flex flex-col items-start gap-2 rounded-sm border border-negative bg-negative-soft px-3 py-2">
          <p role="alert" className="text-[12px] font-bold text-ink">
            Couldn’t preview a remix.
          </p>
          <p className="text-[12px] font-medium text-n-3">
            {preview.error instanceof Error ? preview.error.message : 'The preview failed.'}
          </p>
          <Button variant="stroke" size="sm" onClick={() => preview.preview()}>
            <Icon name="reset" size={13} /> Try again
          </Button>
        </div>
      ) : (
        <PreviewPanel
          plan={plan}
          current={current}
          teamNames={teamNames}
          leagueTimeZone={leagueTimeZone}
          reason={reason}
          onReason={setReason}
          actorName={actorName}
        />
      )}

      {confirm.isError && (
        <StatusBanner tone="caution" className="border-negative bg-negative-soft">
          <span role="alert">
            {confirm.error instanceof Error ? confirm.error.message : 'The remix was refused.'}
          </span>
        </StatusBanner>
      )}

      <DialogFooter className="gap-2">
        {applied ? (
          <Button variant="blue" size="md" onClick={close}>
            Done
          </Button>
        ) : (
          <>
            <Button variant="stroke" size="md" onClick={close} disabled={confirm.isPending}>
              Cancel
            </Button>
            <Button
              variant="stroke"
              size="md"
              onClick={() => {
                confirm.reset()
                preview.preview()
              }}
              disabled={preview.isPending || confirm.isPending}
            >
              <Icon name="repeat" size={13} /> Roll again
            </Button>
            <ConfirmButton
              plan={plan}
              reason={reason}
              pending={confirm.isPending}
              onConfirm={() =>
                plan && confirm.confirm({ seed: plan.seed, reason: reason.trim() || null })
              }
            />
          </>
        )}
      </DialogFooter>
    </>
  )
}

function ConfirmButton({
  plan,
  reason,
  pending,
  onConfirm,
}: {
  plan: RemixPreview | null
  reason: string
  pending: boolean
  onConfirm: () => void
}) {
  const gate = confirmGate(plan, reason)
  return (
    <span className="flex flex-col items-end gap-1">
      <Button
        variant="blue"
        size="md"
        onClick={onConfirm}
        disabled={!gate.ok || pending}
        data-confirm-remix
      >
        {pending ? 'Confirming…' : 'Confirm remix'}
      </Button>
      {!gate.ok && plan && (
        <span className="text-[10px] font-medium text-n-3" data-confirm-gate>
          {gate.why}
        </span>
      )}
    </span>
  )
}

function PreviewPanel({
  plan,
  current,
  teamNames,
  leagueTimeZone,
  reason,
  onReason,
  actorName,
}: {
  plan: RemixPreview
  current: readonly ScheduleMatchup[]
  teamNames: ReadonlyMap<string, string>
  leagueTimeZone: string | null
  reason: string
  onReason: (value: string) => void
  actorName: string
}) {
  const kickoff = plan.window.first_kickoff_at
    ? formatKickoff(plan.window.first_kickoff_at, leagueTimeZone)
    : null
  const copy = remixWindowCopy(plan.window, kickoff?.local ?? null)
  const weeks = sideBySide(current, plan.proposed, teamNames)
  const groups = diffByWeek(plan.diff)

  return (
    <div className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto pr-1">
      <div data-window={plan.window.free ? 'free' : 'override'}>
        <StatusBanner tone={copy.tone}>
          <span title={kickoff?.title ?? undefined}>
            <strong>{copy.title}</strong> — {copy.body}
          </span>
        </StatusBanner>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-[11px] font-medium text-n-3">
        <Badge variant="stroke">
          seed <span className="fs-num">{plan.seed}</span>
        </Badge>
        <span>
          <span className="fs-num">{plan.weeks_regenerable.length}</span> of{' '}
          <span className="fs-num">{plan.regular_season_weeks}</span> weeks regenerate ·{' '}
          <span className="fs-num">{plan.change_count}</span> team-week pairings change
        </span>
      </div>

      {plan.no_changes && (
        <p
          role="status"
          className="rounded-sm border border-ink bg-white px-3 py-2 text-[12px] font-semibold text-n-3"
        >
          This seed reproduces the current season exactly — nothing would change.
        </p>
      )}

      {plan.weeks_frozen.length > 0 && (
        <ul className="flex flex-col gap-0.5 text-[11px] font-medium text-n-3" data-frozen-weeks>
          {plan.weeks_frozen.map((f) => (
            <li key={f.week}>{frozenWeekCopy(f)}</li>
          ))}
        </ul>
      )}

      <div className="grid grid-cols-[auto_1fr_1fr] gap-x-3 gap-y-1 text-[12px]" data-side-by-side>
        <span className="fs-overline text-[9px] text-n-3">Week</span>
        <span className="fs-overline text-[9px] text-n-3">Current</span>
        <span className="fs-overline text-[9px] text-n-3">Proposed</span>
        {weeks.map((w) => (
          <div
            key={w.week}
            className="contents"
            data-week={w.week}
            data-regenerated={w.regenerated}
          >
            <span className="fs-num border-t border-n-4 pt-1 font-bold">
              {w.week}
              {!w.regenerated && <span className="ml-1 text-[9px] font-medium text-n-3">kept</span>}
            </span>
            <PairingList cells={w.current} />
            <PairingList cells={w.proposed} />
          </div>
        ))}
      </div>

      {groups.length > 0 && (
        <details className="text-[12px]">
          <summary className="cursor-pointer font-bold text-ink">
            Every change, in words (<span className="fs-num">{plan.change_count}</span>)
          </summary>
          <ul className="mt-1 flex flex-col gap-0.5 font-medium text-n-3" data-diff-lines>
            {groups
              .flatMap((g) => g.lines)
              .map((line) => (
                <li key={`${line.week}:${line.round_type}:${line.team_id}`}>{line.text}</li>
              ))}
          </ul>
        </details>
      )}

      {plan.window.reason_required && (
        <label className="flex flex-col gap-1 text-[11px] font-bold text-ink">
          Reason (required — posted to league chat)
          <Input
            className="h-btn-md px-2 text-[12px]"
            value={reason}
            onChange={(e) => onReason(e.target.value)}
            placeholder="Why the season is being re-drawn after kickoff"
            maxLength={500}
            data-remix-reason
          />
        </label>
      )}

      <div className="flex flex-col gap-1">
        <span className="fs-overline text-[9px] text-n-3">Preview of the league chat post</span>
        <p
          className="rounded-sm border border-ink bg-white px-3 py-2 text-[12px] font-medium text-ink"
          data-system-post-preview
        >
          {systemPostPreview(plan, reason, actorName)}
        </p>
      </div>
    </div>
  )
}

function PairingList({ cells }: { cells: PairingCell[] }) {
  return (
    <ul className="flex flex-col gap-0.5 border-t border-n-4 pt-1">
      {cells.map((c, i) => (
        <li
          key={`${c.round_type}:${c.text}:${i}`}
          data-pairing={c.state}
          className={cn(
            'font-medium',
            c.state === 'changed' && 'bg-accent-soft font-bold text-ink',
            c.state === 'flipped' && 'text-ink',
            c.state === 'same' && 'text-n-3',
          )}
        >
          {c.round_type === 'secondary' && (
            <span className="fs-overline mr-1 text-[9px] text-n-3">2nd</span>
          )}
          {c.text}
          {c.state === 'flipped' && (
            <span className="ml-1 text-[9px] font-medium text-n-3">home/away flipped</span>
          )}
        </li>
      ))}
    </ul>
  )
}

function AppliedPanel({ result }: { result: RemixConfirmResult }) {
  return (
    <div className="flex flex-col gap-2" data-remix-applied>
      <StatusBanner tone="accent">
        <strong>Remix applied.</strong> Weeks {result.weeks_regenerated.join(', ')} regenerated —{' '}
        <span className="fs-num">{result.matchups_replaced}</span> pairings replaced, seed{' '}
        <span className="fs-num">{result.schedule_seed}</span>.
      </StatusBanner>
      <div className="flex flex-col gap-1">
        <span className="fs-overline text-[9px] text-n-3">Posted to league chat</span>
        <p
          className="rounded-sm border border-ink bg-white px-3 py-2 text-[12px] font-medium text-ink"
          data-system-post
        >
          {result.system_post}
        </p>
      </div>
    </div>
  )
}
