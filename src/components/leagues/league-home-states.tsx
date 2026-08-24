'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'

import { PageHeader } from '@/components/layout/app-header'
import {
  MOCK_LAUNCHER_READY,
  mockLauncherHref,
} from '@/components/draft/mock-launcher-entry'
import { MockRow } from '@/components/draft/mock-draft-launcher'
import { mockSeatCount } from '@/components/draft/mock-launcher-ops'
import { MOCK_EXPIRY_NOTE } from '@/components/draft/mock-launcher-ops'
import { useMockDrafts } from '@/hooks/use-mock-drafts'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Icon, type IconName } from '@/components/ui/icon'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from '@/hooks/use-toast'
import {
  LeaguePatchError,
  useLeague,
  useSetLeagueStatus,
  type LeagueDetail,
} from '@/hooks/use-league'
import { useRoomEntryTarget } from '@/hooks/use-room-entry-target'
import { useScoringTemplates } from '@/hooks/use-scoring-templates'
import { leaguesKeys } from '@/hooks/use-leagues'
import { cn } from '@/lib/utils'

import { AddDraftListCta } from './attach-list-modal'
import { InvitePanel } from './invite-panel'
import { Crest } from './league-cells'
import {
  autoStartPollMs,
  deriveSetupChecklist,
  describeDraftTime,
  draftCountdown,
  homeStateForStatus,
  laterStatusLabel,
  seatCounts,
  type ChecklistItem,
} from './league-home-states-ops'

/**
 * League home — the §16.5.1 status state machine (M1 task L.A2.7; M2 task
 * L.B3.4 discharges F38). Reads the REAL league row via `useLeague` and
 * renders the hero for its status:
 *   - `setup`     → the setup checklist + the full invite panel (share link,
 *                   seats, roles — L.A2.5; each empty seat carries an invite
 *                   affordance, R112) + the §7.1 "Schedule the draft"
 *                   transition once a draft time is saved (L.B3.4 — what
 *                   arms the D94 auto-start)
 *   - `scheduled` → the draft countdown (league TZ + viewer-local, §16.4;
 *                   D98 named zone when set) with the REAL Enter-draft-lobby
 *                   CTA (F38 discharged) and Practice-this-draft behind the
 *                   L.B3.5 ready-flag, plus the invite panel
 *   - `drafting`  → the LIVE hero (§16.5.1: LIVE badge + Join draft)
 *   - later       → in_season/playoffs/complete stay the clearly-marked
 *                   "not yet" placeholder until M4 (F46), never mock data
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
      {state === 'drafting' && <DraftingHero leagueId={leagueId} data={data} />}
      {state === 'later' && <LaterPlaceholder status={league.status} />}

      {/* §16.5.2 mock-workflow row (L.B3.5): the resumable-paused card —
          a paused/live practice draft resumes from the league page (E59),
          and kept recaps are one tap away. Pre-draft states only: past
          draft night the home belongs to the live draft / the season
          (recaps stay reachable through the launcher's list). Renders
          nothing when the viewer has no mocks — the home stays light. */}
      {(state === 'setup' || state === 'scheduled') && (
        <MockPracticeCard leagueId={leagueId} data={data} />
      )}
    </div>
  )
}

/**
 * The launcher-scoped mock list on the league home (§16.5.2: "resumable-
 * paused card on league home · 72h-expiry note"). Rows are the launcher's
 * own `MockRow` — one row treatment, two mounts, no fork. Loading/error
 * render nothing here: the home never blocks on a practice list, and the
 * launcher page carries the full states.
 */
function MockPracticeCard({ leagueId, data }: { leagueId: string; data: LeagueDetail }) {
  const mocks = useMockDrafts(leagueId)
  const active = mocks.data?.active ?? []
  const recaps = mocks.data?.recaps ?? []
  if (active.length === 0 && recaps.length === 0) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Icon name="rocket" size={15} className="mr-1.5 inline align-[-2px]" />
          Your practice drafts
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2.5">
        {active.map((row) => (
          <MockRow
            key={row.id}
            leagueId={leagueId}
            seatCount={mockSeatCount(row, data.teams)}
            row={row}
          />
        ))}
        {recaps.map((row) => (
          <MockRow
            key={row.id}
            leagueId={leagueId}
            seatCount={mockSeatCount(row, data.teams)}
            row={row}
          />
        ))}
        {active.length > 0 && (
          <p className="text-[10px] font-medium text-n-3">{MOCK_EXPIRY_NOTE}</p>
        )}
      </CardContent>
    </Card>
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
        <Crest
          name={league.name}
          src={league.avatar_url}
          className="h-10 w-10"
          fallbackClassName="text-[12px]"
        />
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
  const timeSaved = items.some((i) => i.key === 'schedule' && i.done)
  const setStatus = useSetLeagueStatus(leagueId)

  // L.B3.4: the §7.1 setup → scheduled transition's first UI affordance.
  // The instant alone doesn't schedule the league — the D94 auto-start tick
  // scans `scheduled` leagues only, so without this flip a league would sit
  // in setup past its own draft time forever. The L.A1.13 route validates
  // the CURRENT stored settings before transitioning (per-field 400 → the
  // settings panel is the fix-it surface).
  const handleSchedule = () => {
    setStatus.mutateAsync('scheduled').catch((error: unknown) => {
      toast({
        title: "Couldn't schedule the draft",
        description:
          error instanceof LeaguePatchError
            ? error.fieldErrors
              ? 'Some settings need attention first — check League settings.'
              : error.message
            : 'Something went wrong. Please try again.',
        variant: 'destructive',
      })
    })
  }

  return (
    <div className="grid grid-cols-1 items-start gap-[19px] lg:grid-cols-[1fr_1.3fr]">
      <Card>
        <CardHeader>
          <CardTitle>League setup</CardTitle>
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

          {isCommish && timeSaved && (
            <div className="mt-1 flex flex-col gap-1.5 border-t border-n-4 pt-3">
              <Button
                type="button"
                variant="blue"
                size="sm"
                shadow
                className="w-fit"
                disabled={setStatus.isPending}
                onClick={handleSchedule}
              >
                <Icon name="calendar" size={13} />
                {setStatus.isPending ? 'Scheduling…' : 'Schedule the draft'}
              </Button>
              <p className="text-[10px] font-semibold text-n-3">
                Locks in draft night: the countdown appears for every manager and the
                draft starts automatically at the scheduled time.
              </p>
            </div>
          )}

          {/* Practice is available from league CREATION — Chris, 2026-08-20:
              "we need to remove that". §16.5.1's "once a draft is configured"
              gated this on `timeSaved` (a draft datetime saved in settings),
              which is the wrong dependency: a practice draft rehearses the
              league's SETTINGS — draft type, roster, budget, clocks — and
              those exist from creation with defaults. The scheduled instant
              has no bearing on how a draft runs. The gate made a brand-new
              league show no way to try a draft at all, which is the first
              thing a commissioner wants to do. Any member (§8.8's launch
              rule); the Schedule button above keeps its own `timeSaved`
              gate, which IS the right dependency for locking in draft night. */}
          <div className="mt-1 flex flex-col gap-1.5 border-t border-n-4 pt-3">
              <PracticeCta leagueId={leagueId} />
              <p className="text-[10px] font-semibold text-n-3">
                Test these settings against CPU opponents before draft night.
              </p>
          </div>

          {/* §7.4's reverse entry (M2 L.B4.2): draft prep starts in setup —
              any member, no time-saved gate (attaching needs no schedule). */}
          <div className="mt-1 flex flex-col gap-1.5 border-t border-n-4 pt-3">
            <AddDraftListCta
              leagueId={leagueId}
              leagueName={data.league.name}
              scoringSystemId={data.league.scoring_system_id}
            />
            <p className="text-[10px] font-semibold text-n-3">
              Attach one of your ranking lists — it&rsquo;s one tap away in the
              draft room and can feed your autopick.
            </p>
          </div>
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
  const timeZone = settings.draft.time_zone
  const orderMode = settings.draft.draft_order_mode
  // DR.6 entry split (§16.1 v2.12): desktop opens the room in a new tab.
  const roomEntry = useRoomEntryTarget()

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
            <DraftCountdown leagueId={leagueId} scheduledAt={scheduledAt} timeZone={timeZone} />
          ) : (
            <p className="text-[12px] font-semibold text-n-3">
              A draft time hasn&apos;t been set yet. Add one in League settings.
            </p>
          )}

          {/* F38 discharged (L.B3.4): the CTAs are real. Enter draft lobby →
              the room route's pre-start lobby; Run mock draft → the
              L.B3.5 launcher entry behind its ready-flag (visible now,
              enabled the moment the launcher lands — lane order can't
              dead-end). */}
          <div className="flex flex-wrap items-center gap-2.5">
            <Button variant="stroke" size="sm" asChild>
              <Link href={`/app/leagues/${leagueId}/draft`} {...roomEntry}>
                <Icon name="fire" size={13} />
                Enter draft lobby
              </Link>
            </Button>
            <PracticeCta leagueId={leagueId} />
            {/* §7.4's reverse entry (M2 L.B4.2). */}
            <AddDraftListCta
              leagueId={leagueId}
              leagueName={data.league.name}
              scoringSystemId={data.league.scoring_system_id}
            />
          </div>
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

/**
 * "Run mock draft" — wired to the L.B3.5 launcher entry behind its
 * ready-flag (mock-launcher-entry.ts). Until the launcher lands the CTA is
 * visibly present but honestly disabled; L.B3.5 flips the flag and this
 * becomes a live link with zero rewiring.
 *
 * Exported for the draft lobby (R279): §16.5.2's mock-workflow row names TWO
 * entry points — "Practice card · draft lobby" — and both mount THIS
 * component (one treatment, no fork).
 */
export function PracticeCta({ leagueId }: { leagueId: string }) {
  if (!MOCK_LAUNCHER_READY) {
    return (
      <Button variant="stroke" size="sm" disabled title="Mock drafts arrive with the next update">
        <Icon name="rocket" size={13} />
        Run mock draft
      </Button>
    )
  }
  return (
    <Button variant="stroke" size="sm" asChild>
      <Link href={mockLauncherHref(leagueId)}>
        <Icon name="rocket" size={13} />
        Run mock draft
      </Link>
    </Button>
  )
}

function DraftCountdown({
  leagueId,
  scheduledAt,
  timeZone,
}: {
  leagueId: string
  scheduledAt: string
  timeZone?: string | null
}) {
  // Component-layer wall clock (the D3 TimeProvider guard is scoped to
  // `src/lib/leagues/**`; this is UI display). The pure `draftCountdown` takes
  // nowMs, so the math stays deterministic and pinned.
  const [nowMs, setNowMs] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

  // D94 auto-start watch: near/past the instant the SERVER starts the draft
  // (the tick creates the drafts row if absent) and nothing pushes that flip
  // to a countdown viewer — poll the league detail while the window is hot
  // so the hero flips to LIVE without a manual refresh.
  const queryClient = useQueryClient()
  const pollMs = autoStartPollMs(scheduledAt, nowMs)
  useEffect(() => {
    if (pollMs === null) return
    const timer = setInterval(() => {
      void queryClient.invalidateQueries({ queryKey: leaguesKeys.detail(leagueId) })
    }, pollMs)
    return () => clearInterval(timer)
  }, [pollMs, leagueId, queryClient])

  const cd = draftCountdown(scheduledAt, nowMs)
  const display = describeDraftTime(scheduledAt, timeZone)

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
// Drafting hero — LIVE badge + Join draft (§16.5.1 drafting row · L.B3.4/F38)
// ---------------------------------------------------------------------------

/**
 * The `drafting` home hero (task L.B3.4 item 2 — the row's printed scope:
 * LIVE badge + Join draft). Who's-in-the-room presence deliberately does NOT
 * render here: presence is channel state, and opening the draft channel from
 * the home would spend a second subscription on a page whose one CTA leads
 * to the room that already owns it (§9.3's ≤ 3-channel budget; recorded in
 * D120). The room is one tap away.
 */
function DraftingHero({ leagueId, data }: { leagueId: string; data: LeagueDetail }) {
  const startedAt = data.active_draft?.started_at ?? null
  // DR.6 entry split (§16.1 v2.12): desktop opens the room in a new tab.
  const roomEntry = useRoomEntryTarget()

  return (
    <Card className="flex flex-col items-center gap-3 px-6 py-14 text-center">
      <Badge variant="lime" className="w-fit">
        <span className="h-1.5 w-1.5 animate-pulse rounded-pill bg-current" />
        LIVE
      </Badge>
      <p className="text-h5 text-ink">The draft is live</p>
      <p className="max-w-md text-[13px] font-medium text-n-3">
        {startedAt
          ? `Picks are coming off the board — the room opened at ${new Date(startedAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}.`
          : 'Picks are coming off the board right now.'}
      </p>
      <Button variant="blue" size="sm" shadow asChild>
        <Link href={`/app/leagues/${leagueId}/draft`} {...roomEntry}>
          <Icon name="fire" size={13} />
          Join draft
        </Link>
      </Button>
    </Card>
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
      {/* Post-draft statuses only from here (F46): drafting has its real hero. */}
      <p className="max-w-md text-[13px] font-medium text-n-3">
        The in-season experience lands in a later update. Your league is safe — this
        screen fills in as those features ship.
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
