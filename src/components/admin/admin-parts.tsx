'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState, type ReactNode } from 'react'

import { PageHeader } from '@/components/layout/app-header'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { segmentGroupVariants, segmentItemVariants } from '@/components/ui/tabs'
import { useToast } from '@/hooks/use-toast'
import { useAdminVerb } from '@/hooks/use-admin-verb'
import { AdminApiError, newActionId } from '@/lib/admin/admin-api'
import { cn } from '@/lib/utils'

import {
  GAME_STATUS_LABEL,
  JOB_DOES,
  JOB_NAME,
  VERB_LABEL,
  canPause,
  gameBeforeAfter,
  gameStatusChoices,
  jobBeforeAfter,
  jobKnobState,
  noOpWords,
  type JobVerb,
  type OpGame,
  type OpGameStatus,
  type OpJob,
  type OpPause,
  type OpVerbResult,
} from './admin-console-ops'

// ---------------------------------------------------------------------------
// The console's tabs (the PageHeader sub-nav). Persona-post review keeps its
// place as a tab (TD8).
// ---------------------------------------------------------------------------
export const ADMIN_TABS = [
  { href: '/app/admin', label: 'Home', exact: true },
  { href: '/app/admin/leagues', label: 'Leagues', exact: false },
  { href: '/app/admin/notify', label: 'Notify', exact: false },
  { href: '/app/admin/log', label: 'Log', exact: false },
  { href: '/app/admin/posts', label: 'Posts', exact: false },
] as const

export function AdminTabs() {
  const pathname = usePathname() ?? ''
  return (
    <nav aria-label="Admin" className="overflow-x-auto pb-2" data-admin-tabs>
      <div className={cn(segmentGroupVariants({ appearance: 'bare' }), 'w-max')}>
        {ADMIN_TABS.map((t) => {
          const active = t.exact ? pathname === t.href : pathname.startsWith(t.href)
          return (
            <Link
              key={t.href}
              href={t.href}
              aria-current={active ? 'page' : undefined}
              data-state={active ? 'active' : 'inactive'}
              className={segmentItemVariants({ appearance: 'bare', shape: 'label' })}
            >
              {t.label}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}

/**
 * The console's page header: the standard `PageHeader` (title + the tabs as
 * its sub-nav on desktop). The shell's in-page mobile row shows the title
 * only, so the tabs repeat in the page below `desk`.
 */
export function AdminHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <>
      <PageHeader title={title} subtitle={subtitle} subnav={<AdminTabs />} inPageOnMobile />
      <div className="-mt-3 desk:hidden" data-admin-tabs-mobile>
        <AdminTabs />
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// Section card + the three non-data states
// ---------------------------------------------------------------------------
export function AdminSection({
  title,
  hint,
  children,
  action,
  ...rest
}: {
  title: string
  hint?: ReactNode
  children: ReactNode
  action?: ReactNode
  'data-admin-section'?: string
}) {
  return (
    <Card data-admin-section={rest['data-admin-section']}>
      <CardHeader className="min-h-0 flex-col items-stretch justify-start gap-1 border-b-0 px-4 pb-1 pt-3.5">
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="mr-auto text-[15px] font-bold tracking-[-0.02em]">{title}</CardTitle>
          {action}
        </div>
        {hint && <p className="text-[10px] font-medium text-n-6">{hint}</p>}
      </CardHeader>
      <CardContent className="flex flex-col gap-2 px-4 pb-4 pt-1.5">{children}</CardContent>
    </Card>
  )
}

export function AdminLoading({ rows = 3, label }: { rows?: number; label: string }) {
  return (
    <div className="flex flex-col gap-1.5" data-admin-loading={label} aria-busy="true">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-10 rounded-md" />
      ))}
    </div>
  )
}

export function AdminError({ error, onRetry, what }: { error: unknown; onRetry?: () => void; what: string }) {
  const msg = error instanceof Error ? error.message : 'Something went wrong.'
  const unavailable = error instanceof AdminApiError && error.status === 503
  return (
    <div
      className="flex flex-col items-start gap-2 rounded-md bg-negative-soft px-3 py-2.5"
      role="alert"
      data-admin-error={unavailable ? 'unavailable' : 'failed'}
    >
      <p className="text-[12px] font-semibold text-ink">Couldn’t load {what}.</p>
      <p className="text-[11px] font-medium text-n-3">{msg}</p>
      {onRetry && !unavailable && (
        <Button size="sm" variant="stroke" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  )
}

export function AdminEmpty({ children, label }: { children: ReactNode; label: string }) {
  return (
    <p className="py-2 text-[11px] font-medium text-n-6" data-admin-empty={label}>
      {children}
    </p>
  )
}

export function when(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

// ---------------------------------------------------------------------------
// The confirm dialog every control opens: before → after, optional reason,
// and ONE action id for the dialog's life (retries reuse it — TD3).
// ---------------------------------------------------------------------------
export interface ConfirmSpec {
  title: string
  before: string
  after: string
  confirmLabel: string
  url: string
  body: Record<string, unknown>
  danger?: boolean
}

export function ConfirmActionDialog({ spec, onClose }: { spec: ConfirmSpec | null; onClose: () => void }) {
  return (
    <Dialog open={spec !== null} onOpenChange={(o) => !o && onClose()}>
      {/* Keyed on the spec, and remounted on every open: each opening is a NEW
          attempt with a fresh action id (TD3). Only a retry inside the same
          open dialog reuses its id; closing and reopening never does. */}
      {spec && <ConfirmBody key={`${spec.url}:${JSON.stringify(spec.body)}`} spec={spec} onClose={onClose} />}
    </Dialog>
  )
}

function ConfirmBody({ spec, onClose }: { spec: ConfirmSpec; onClose: () => void }) {
  const { toast } = useToast()
  const verb = useAdminVerb()
  const [actionId] = useState(newActionId)
  const [reason, setReason] = useState('')
  const [result, setResult] = useState<OpVerbResult | null>(null)

  const submit = () => {
    verb.mutate(
      { url: spec.url, body: { ...spec.body, action_id: actionId, reason: reason.trim() || undefined } },
      {
        onSuccess: (r) => {
          if (r.changed) {
            toast({ title: 'Done', description: spec.after })
            onClose()
          } else {
            setResult(r)
          }
        },
      },
    )
  }

  return (
    <DialogContent className="max-w-md" data-admin-confirm>
      <DialogHeader>
        <DialogTitle>{spec.title}</DialogTitle>
        <DialogDescription className="sr-only">What changes when you confirm</DialogDescription>
      </DialogHeader>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-[12px]">
        <dt className="font-bold text-n-6">Now</dt>
        <dd className="font-medium text-ink" data-confirm-before>{spec.before}</dd>
        <dt className="font-bold text-n-6">After</dt>
        <dd className="font-semibold text-ink" data-confirm-after>{spec.after}</dd>
      </dl>
      <div className="flex flex-col gap-1">
        <Label htmlFor="admin-reason" className="text-[11px]">Reason (optional)</Label>
        <Input
          id="admin-reason"
          value={reason}
          maxLength={500}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Kept in the operator log"
        />
      </div>
      {result && !result.changed && (
        <p className="rounded-md bg-surface-sunken px-3 py-2 text-[11px] font-medium text-ink" data-confirm-noop>
          Nothing changed. {noOpWords(result.why)}
        </p>
      )}
      {verb.error && (
        <p className="rounded-md bg-negative-soft px-3 py-2 text-[11px] font-medium text-ink" role="alert" data-confirm-error>
          {verb.error.message}
        </p>
      )}
      <DialogFooter className="gap-2">
        <Button variant="ghost" onClick={onClose}>
          {result ? 'Close' : 'Cancel'}
        </Button>
        {!result && (
          <Button variant={spec.danger ? 'warning' : 'blue'} onClick={submit} disabled={verb.isPending} data-confirm-go>
            {verb.isPending ? 'Working…' : verb.error ? 'Try again' : spec.confirmLabel}
          </Button>
        )}
      </DialogFooter>
    </DialogContent>
  )
}

// ---------------------------------------------------------------------------
// Job knobs (Q98) — one row per job, for one league or every league
// ---------------------------------------------------------------------------
export function JobKnobs({
  pauses,
  leagueId,
  onConfirm,
}: {
  pauses: readonly OpPause[]
  leagueId: string | null
  onConfirm: (spec: ConfirmSpec) => void
}) {
  const jobs: OpJob[] = ['waivers', 'week-advance', 'week-finalize', 'lineup-lock']
  const open = (job: OpJob, verb: JobVerb) => {
    const ba = jobBeforeAfter(job, verb, leagueId)
    onConfirm({
      title: `${VERB_LABEL[verb]}: ${JOB_NAME[job]}${leagueId === null ? ' (every league)' : ''}`,
      ...ba,
      confirmLabel: VERB_LABEL[verb],
      url: '/api/admin/jobs',
      body: { verb, job, league_id: leagueId ?? undefined },
      danger: verb === 'pause',
    })
  }
  return (
    <ol className="flex flex-col divide-y divide-n-4" data-job-knobs={leagueId === null ? 'all' : 'league'}>
      {jobs.map((job) => {
        const st = jobKnobState(job, pauses, leagueId)
        const pausedAnywhere = st.pausedHere ?? st.pausedEverywhere
        return (
          <li key={job} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2" data-job={job}>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-[12px] font-semibold text-ink">
                {JOB_NAME[job]}
                {pausedAnywhere && (
                  <span className="ml-2 rounded-pill bg-caution-soft px-2 py-0.5 text-[10px] font-bold text-caution-strong" data-job-paused>
                    Paused{st.pausedHere ? '' : ' for every league'}
                  </span>
                )}
              </span>
              <span className="text-[10px] font-medium text-n-6">
                {st.pausedEverywhere && !st.pausedHere
                  ? 'Paused for every league — resume it from Admin home.'
                  : JOB_DOES[job]}
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {canPause(job) && !st.pausedHere && (
                <Button size="sm" variant="stroke" onClick={() => open(job, 'pause')} data-knob="pause">
                  Pause
                </Button>
              )}
              {canPause(job) && st.pausedHere && (
                <Button size="sm" variant="blue" onClick={() => open(job, 'resume')} data-knob="resume">
                  Resume
                </Button>
              )}
              {/* Run now never bypasses a pause (183): resume first. */}
              {!pausedAnywhere && (
                <Button size="sm" variant="stroke" onClick={() => open(job, 'run_now')} data-knob="run_now">
                  Run now
                </Button>
              )}
            </div>
          </li>
        )
      })}
    </ol>
  )
}

// ---------------------------------------------------------------------------
// A game row with its mark control (Q100)
// ---------------------------------------------------------------------------
export function GameRow({ game, onConfirm }: { game: OpGame; onConfirm: (spec: ConfirmSpec) => void }) {
  const choices = gameStatusChoices(game)
  const open = (to: OpGameStatus) => {
    onConfirm({
      title: `${game.matchup}: ${GAME_STATUS_LABEL[to].toLowerCase()}`,
      ...gameBeforeAfter(game, to),
      confirmLabel: GAME_STATUS_LABEL[to],
      url: `/api/admin/games/${encodeURIComponent(game.game_id)}/status`,
      body: { status: to },
      danger: to === 'out_of_week' || to === 'cancelled',
    })
  }
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2" data-game={game.game_id}>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-[12px] font-semibold text-ink">
          {game.matchup}
          {game.season != null && game.week != null && (
            <span className="ml-1.5 font-medium text-n-6">· Week <span className="fs-num">{game.week}</span></span>
          )}
        </span>
        <span className="text-[10px] font-medium text-n-6" data-game-reason>
          {when(game.kickoff_at)} · {game.reason}
        </span>
      </div>
      {choices.length > 0 && (
        <div className="flex flex-wrap gap-1.5" data-game-marks>
          {choices.map((to) => (
            <Button key={to} size="sm" variant={to === 'normal' ? 'blue' : 'stroke'} onClick={() => open(to)} data-mark={to}>
              {GAME_STATUS_LABEL[to]}
            </Button>
          ))}
        </div>
      )}
    </li>
  )
}
