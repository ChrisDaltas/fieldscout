'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

import { PageHeader } from '@/components/layout/app-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Icon, type IconName } from '@/components/ui/icon'
import { Skeleton } from '@/components/ui/skeleton'
import { useLeague, type LeagueDetail } from '@/hooks/use-league'
import { useScoringTemplates } from '@/hooks/use-scoring-templates'
import { cn } from '@/lib/utils'

import { InvitePanel } from './invite-panel'
import { Crest } from './league-cells'
import {
  deriveSetupChecklist,
  describeDraftTime,
  draftCountdown,
  homeStateForStatus,
  laterStatusLabel,
  seatCounts,
  type ChecklistItem,
} from './league-home-states-ops'

/**
 * League home — the §16.5.1 status state machine (M1 task L.A2.7). Reads the
 * REAL league row via `useLeague` and renders the hero for its status:
 *   - `setup`     → the setup checklist + the full invite panel (share link,
 *                   seats, roles — L.A2.5; each empty seat carries an invite
 *                   affordance, R112)
 *   - `scheduled` → the draft countdown (league TZ + viewer-local, §16.4) with
 *                   the Enter-lobby / Practice-draft CTAs stubbed → M2, plus
 *                   the invite panel (seats can still fill before the draft)
 *   - later       → a clearly-marked "not yet" placeholder, never mock data
 *
 * The separate Manage-league page folded into this one: the invite panel
 * renders here directly, and read-only settings summaries were dropped — the
 * grouped settings panel (`/settings`) is the single settings surface.
 *
 * Skeleton / empty / error per §16.5.4. This replaced the mock `LeagueWorkspace`
 * (deleted with its in-season tabs — the real in-season surfaces are M4).
 */
export function LeagueHomeStates({ leagueId }: { leagueId: string }) {
  const { data, isPending, isError, refetch } = useLeague(leagueId)

  if (isPending) {
    return <LeagueHomeSkeleton />
  }

  if (isError || !data) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="League" />
        <Card className="border-negative bg-negative-soft">
          <CardContent className="flex flex-col items-start gap-2 p-4">
            <p className="text-[13px] font-bold" role="alert">
              Couldn&apos;t load this league.
            </p>
            <p className="text-[12px] font-medium text-n-3">
              It may have been removed, or you no longer have access.
            </p>
            <div className="flex items-center gap-2.5">
              <Button variant="stroke" size="sm" onClick={() => refetch()}>
                <Icon name="reset" size={13} /> Retry
              </Button>
              <Button variant="stroke" size="sm" asChild>
                <Link href="/app/leagues">Back to leagues</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  return <LeagueHomeContent leagueId={leagueId} data={data} />
}

function LeagueHomeContent({ leagueId, data }: { leagueId: string; data: LeagueDetail }) {
  const { league, my_role } = data
  const isCommish = my_role === 'commissioner' || my_role === 'co_commissioner'
  const state = homeStateForStatus(league.status)

  const settingsHref = `/app/leagues/${leagueId}/settings`

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={league.name}
        actions={
          isCommish ? (
            <Button variant="stroke" size="sm" asChild>
              <Link href={settingsHref}>
                <Icon name="setup" size={13} />
                League settings
              </Link>
            </Button>
          ) : undefined
        }
      />

      <LeagueMetaRow data={data} />

      {state === 'setup' && (
        <SetupHero
          leagueId={leagueId}
          data={data}
          isCommish={isCommish}
          settingsHref={settingsHref}
        />
      )}
      {state === 'scheduled' && (
        <ScheduledHero leagueId={leagueId} data={data} settingsHref={settingsHref} />
      )}
      {state === 'later' && <LaterPlaceholder status={league.status} />}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Header / meta row
// ---------------------------------------------------------------------------

const STATUS_BADGE: Record<string, { label: string; variant: 'yellow' | 'lime' | 'stroke' | 'green' }> = {
  setup: { label: 'Setup', variant: 'yellow' },
  scheduled: { label: 'Draft scheduled', variant: 'lime' },
  drafting: { label: 'Draft live', variant: 'lime' },
  in_season: { label: 'In season', variant: 'green' },
  playoffs: { label: 'Playoffs', variant: 'green' },
  complete: { label: 'Complete', variant: 'stroke' },
}

function LeagueMetaRow({ data }: { data: LeagueDetail }) {
  const { league } = data
  const seats = seatCounts(data)
  const badge = STATUS_BADGE[league.status] ?? { label: league.status, variant: 'stroke' as const }

  return (
    <Card>
      <CardContent className="flex flex-wrap items-center gap-3 px-card-pad py-3">
        <Crest name={league.name} className="h-10 w-10" fallbackClassName="text-[12px]" />
        <div className="mr-auto min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <h1 className="truncate text-[17px] font-extrabold leading-tight">{league.name}</h1>
            <Badge variant={badge.variant}>{badge.label}</Badge>
          </div>
          <div className="mt-1 truncate text-[10px] font-semibold text-n-3">
            <span className="fs-num">{league.season}</span> season ·{' '}
            <span className="fs-num">{seats.filled}</span>/
            <span className="fs-num">{seats.total}</span> managers
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Setup hero — checklist + seat list (§16.5.1 setup row · R112)
// ---------------------------------------------------------------------------

function SetupHero({
  leagueId,
  data,
  isCommish,
  settingsHref,
}: {
  leagueId: string
  data: LeagueDetail
  isCommish: boolean
  settingsHref: string
}) {
  const items = deriveSetupChecklist(data)

  return (
    <div className="grid grid-cols-1 items-start gap-[19px] lg:grid-cols-[1fr_1.3fr]">
      <Card>
        <CardHeader>
          <CardTitle>Get your league ready</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2.5">
          {items.map((item) => (
            <ChecklistRow
              key={item.key}
              item={item}
              href={checklistHref(item.key, settingsHref)}
              actionable={isCommish}
            />
          ))}
        </CardContent>
      </Card>

      {/* The full L.A2.5 invite surface, in place (share link, seats, roles). */}
      <div id="invites">
        <InvitePanel leagueId={leagueId} detail={data} />
      </div>
    </div>
  )
}

function checklistHref(key: ChecklistItem['key'], settingsHref: string): string {
  // Seats are handled right here on the home page by the invite panel.
  if (key === 'seats') return '#invites'
  // settings · scoring · schedule all live in the grouped settings panel; the
  // full draft date/time surface (draft-setup-panel) is M2.
  return settingsHref
}

const CHECK_ICON: Record<ChecklistItem['key'], IconName> = {
  settings: 'setup',
  seats: 'team',
  scoring: 'chart',
  schedule: 'calendar',
}

function ChecklistRow({
  item,
  href,
  actionable,
}: {
  item: ChecklistItem
  href: string
  actionable: boolean
}) {
  const body = (
    <div
      className={cn(
        'flex items-center gap-2.5 rounded-sm border border-n-4 px-2.5 py-2 transition-colors',
        actionable && 'hover:border-ink hover:bg-n-4',
      )}
    >
      <Icon
        name={item.done ? 'check-circle' : CHECK_ICON[item.key]}
        size={16}
        className={cn('shrink-0', item.done ? 'text-positive-strong' : 'text-n-3')}
      />
      <div className="mr-auto min-w-0">
        <div className="truncate text-[12px] font-extrabold leading-tight">{item.label}</div>
        <div className="truncate text-[10px] font-semibold text-n-3">{item.detail}</div>
      </div>
      {item.done ? (
        <Badge variant="green">Done</Badge>
      ) : (
        actionable && <Icon name="arrow-next" size={13} className="shrink-0 text-n-3" />
      )}
    </div>
  )

  // Only the commissioner gets the action link; members see a read-only row.
  return actionable ? (
    <Link href={href} aria-label={item.label}>
      {body}
    </Link>
  ) : (
    body
  )
}

// ---------------------------------------------------------------------------
// Scheduled hero — draft countdown (§16.5.1 scheduled row · §16.4)
// ---------------------------------------------------------------------------

function ScheduledHero({
  leagueId,
  data,
  settingsHref,
}: {
  leagueId: string
  data: LeagueDetail
  settingsHref: string
}) {
  const { settings } = data
  const scheduledAt = settings.draft.draft_scheduled_at
  const orderMode = settings.draft.draft_order_mode

  const { data: templates, isPending: templatesPending } = useScoringTemplates()
  const templateName =
    templates?.find((t) => t.id === data.league.scoring_system_id)?.name ?? null

  return (
    <div className="grid grid-cols-1 items-start gap-[19px] lg:grid-cols-[1.3fr_1fr]">
      <Card>
        <CardHeader>
          <CardTitle>
            <Icon name="clock" size={15} className="mr-1.5 inline align-[-2px]" />
            Draft countdown
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {scheduledAt ? (
            <DraftCountdown scheduledAt={scheduledAt} />
          ) : (
            <p className="text-[12px] font-semibold text-n-3">
              A draft time hasn&apos;t been set yet. Add one in League settings.
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2.5">
            <StubbedCta icon="fire" label="Enter draft lobby" />
            <StubbedCta icon="rocket" label="Practice this draft" />
          </div>
          <p className="text-[10px] font-semibold text-n-3">
            The live draft lobby and mock drafts arrive with the draft room.
          </p>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-[19px]">
        <Card>
          <CardHeader>
            <CardTitle>Scoring</CardTitle>
            <Button variant="stroke" size="sm" asChild>
              <Link href={settingsHref}>
                <Icon name="edit" size={13} />
                Edit
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            {templatesPending ? (
              // R116: don't flash the false-negative "none set" copy while the
              // templates query is still resolving — a league WITH a template
              // would briefly read as having none.
              <Skeleton className="h-5 w-24 rounded-sm" />
            ) : templateName ? (
              <Badge variant="stroke">{templateName}</Badge>
            ) : (
              <p className="text-[12px] font-semibold text-n-3">No scoring template set.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Draft order</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-[12px] font-semibold text-n-3">
              {orderMode === 'random'
                ? 'Order is randomized when the draft begins.'
                : 'Order is revealed before the draft begins.'}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Seats can still fill between scheduling and the draft — the invite
          surface stays available here (it moved home from the manage page). */}
      <div id="invites" className="lg:col-span-2">
        <InvitePanel leagueId={leagueId} detail={data} />
      </div>
    </div>
  )
}

/** A CTA whose destination is the draft room (M2) — visibly present but inert. */
function StubbedCta({ icon, label }: { icon: IconName; label: string }) {
  return (
    <Button variant="stroke" size="sm" disabled title="Arrives with the draft room">
      <Icon name={icon} size={13} />
      {label}
    </Button>
  )
}

function DraftCountdown({ scheduledAt }: { scheduledAt: string }) {
  // Component-layer wall clock (the D3 TimeProvider guard is scoped to
  // `src/lib/leagues/**`; this is UI display). The pure `draftCountdown` takes
  // nowMs, so the math stays deterministic and pinned.
  const [nowMs, setNowMs] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

  const cd = draftCountdown(scheduledAt, nowMs)
  const display = describeDraftTime(scheduledAt)

  if (!cd || !display) {
    return (
      <p className="text-[12px] font-semibold text-n-3">Draft time unavailable.</p>
    )
  }

  return (
    <div className="flex flex-col gap-2.5">
      {cd.isPast ? (
        <Badge variant="lime" className="w-fit">
          Draft window reached
        </Badge>
      ) : (
        <div className="flex items-end gap-3">
          <CountUnit value={cd.days} label="days" />
          <CountUnit value={cd.hours} label="hrs" />
          <CountUnit value={cd.minutes} label="min" />
          <CountUnit value={cd.seconds} label="sec" />
        </div>
      )}

      <div className="flex flex-col gap-0.5 text-[11px] font-semibold">
        {/* Viewer-local (primary, §16.4) — the browser's zone via Intl. */}
        <span>
          <span className="text-n-3">Your time · </span>
          <span className="fs-num">
            {new Date(cd.targetMs).toLocaleString(undefined, {
              weekday: 'short',
              month: 'short',
              day: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
            })}
          </span>
        </span>
        {/* League reference time (§16.4 — the offset it was scheduled with). */}
        <span
          className="text-n-3"
          title="League reference time"
        >
          League time ·{' '}
          <span className="fs-num text-ink">{display.leagueTime}</span>
          {display.leagueOffset && <span> ({display.leagueOffset})</span>}
        </span>
      </div>
    </div>
  )
}

function CountUnit({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex flex-col items-center">
      <span className="fs-num text-[28px] font-extrabold leading-none tabular-nums">
        {String(value).padStart(2, '0')}
      </span>
      <span className="mt-1 text-[9px] font-bold uppercase tracking-[0.08em] text-n-3">
        {label}
      </span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Later statuses — clearly-marked "not yet", never mock data (§16.5.1)
// ---------------------------------------------------------------------------

function LaterPlaceholder({ status }: { status: string }) {
  return (
    <Card className="flex flex-col items-center gap-2 px-6 py-16 text-center">
      <Icon name="rocket" size={18} className="text-n-3" />
      <p className="text-h5 text-ink">{laterStatusLabel(status)}</p>
      <p className="max-w-md text-[13px] font-medium text-n-3">
        The live draft room and in-season experience land in a later update. Your league
        is safe — this screen fills in as those features ship.
      </p>
      <Button variant="stroke" size="sm" asChild>
        <Link href="/app/leagues">Back to leagues</Link>
      </Button>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Skeleton (§16.5.4)
// ---------------------------------------------------------------------------

function LeagueHomeSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="League" />
      <Skeleton className="h-16 rounded-sm" />
      <div className="grid grid-cols-1 gap-[19px] lg:grid-cols-[1.3fr_1fr]">
        <Skeleton className="h-64 rounded-sm" />
        <Skeleton className="h-64 rounded-sm" />
      </div>
    </div>
  )
}
