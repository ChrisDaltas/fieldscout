'use client'

import { useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { useEffect, useState } from 'react'

import { MOCK_LAUNCHER_READY, mockLauncherHref } from '@/components/draft/mock-launcher-entry'
import { MOCK_EXPIRY_NOTE, leagueMockOpenBlocked, mockSeatCount } from '@/components/draft/mock-launcher-ops'
import {
  autoStartPollMs,
  deriveSetupChecklist,
  describeDraftTime,
  draftCountdown,
  type ChecklistItem,
} from '@/components/leagues/league-home-states-ops'
import { MIcon } from '@/components/mobile/ui/m-icon'
import { toast } from '@/hooks/use-toast'
import { LeaguePatchError, useSetLeagueStatus, type LeagueDetail } from '@/hooks/use-league'
import { leaguesKeys } from '@/hooks/use-leagues'
import { useMockDrafts } from '@/hooks/use-mock-drafts'
import { useRoomEntryTarget } from '@/hooks/use-room-entry-target'
import { useScoringTemplates } from '@/hooks/use-scoring-templates'
import { featureFlags } from '@/lib/feature-flags'
import { cn } from '@/lib/utils'

import { DraftListButton, ManagersCard, PracticeRow } from './preseason-parts'

/**
 * League › Matchups before the draft: there are no matchups yet, so the
 * segment is the league's draft home — the app's existing pre-draft content
 * restyled in the mobile language (CLAUDE.md: delete nothing). Setup: the
 * checklist, Schedule the draft, practice and list doors, invites.
 * Scheduled: the countdown, the lobby, scoring and draft-order cards,
 * invites. Drafting: the live draft card. Practice drafts you kept, while
 * pre-draft. The managers card, the list picker and the practice rows are
 * the app's own pieces rebuilt in the mobile language over the same reads
 * and writes (`preseason-parts.tsx`).
 */
export function PreseasonContent({ leagueId, detail }: { leagueId: string; detail: LeagueDetail }) {
  const status = detail.league.status
  const isCommish = detail.my_role === 'commissioner' || detail.my_role === 'co_commissioner'
  return (
    <div className="flex flex-col gap-4 px-3 pb-5 pt-2.5" data-preseason={status}>
      {status === 'setup' && <SetupCard leagueId={leagueId} detail={detail} isCommish={isCommish} />}
      {status === 'scheduled' && <ScheduledCards leagueId={leagueId} detail={detail} />}
      {status === 'drafting' && <DraftingCard leagueId={leagueId} detail={detail} />}
      {status !== 'setup' && status !== 'scheduled' && status !== 'drafting' && (
        <div className="flex flex-col items-center gap-2 rounded-[16px] bg-m-b1 px-4 py-8 text-center">
          <span className="text-[15px] font-semibold text-m-t1">This league page didn’t load</span>
          <span className="text-[13px] font-medium text-m-t3">Your league is safe. Head back to your leagues and open it again.</span>
          <Link href="/app/leagues" className="text-[14px] font-semibold text-accent">
            Back to leagues
          </Link>
        </div>
      )}
      {(status === 'setup' || status === 'scheduled') && <PracticeDraftsCard leagueId={leagueId} detail={detail} />}
      {(status === 'setup' || status === 'scheduled') && <ManagersCard leagueId={leagueId} detail={detail} />}
    </div>
  )
}

const CARD = 'flex flex-col gap-3 rounded-[16px] bg-m-b1 p-3.5'
const H = 'text-[15px] font-semibold text-m-t1'
const PILL = 'flex h-9 items-center gap-1.5 rounded-pill px-4 text-[13px] font-semibold'
const PRIMARY = `${PILL} bg-accent text-white active:bg-accent-strong disabled:opacity-50`
const SECONDARY = `${PILL} bg-m-b0 text-m-t1 active:bg-m-b2`
const NOTE = 'text-[12px] font-medium leading-[1.35] text-m-t3'

function PracticeLink({ leagueId }: { leagueId: string }) {
  if (!MOCK_LAUNCHER_READY) {
    return (
      <span className={cn(SECONDARY, 'w-fit text-m-t4')} aria-disabled="true">
        Run mock draft
      </span>
    )
  }
  return (
    <Link href={mockLauncherHref(leagueId)} className={cn(SECONDARY, 'w-fit')}>
      Run mock draft
    </Link>
  )
}

function checklistHref(key: ChecklistItem['key'], leagueId: string): string {
  const settings = `/app/leagues/${leagueId}/settings`
  if (key === 'seats') return '#invites'
  if (key === 'scoring') return `${settings}?section=scoring`
  if (key === 'schedule') return `${settings}?section=draft`
  return settings
}

function SetupCard({ leagueId, detail, isCommish }: { leagueId: string; detail: LeagueDetail; isCommish: boolean }) {
  const items = deriveSetupChecklist(detail)
  const timeSaved = items.some((i) => i.key === 'schedule' && i.done)
  const setStatus = useSetLeagueStatus(leagueId)
  const schedule = () => {
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
    <section className={CARD} aria-label="League setup">
      <h2 className={H}>League setup</h2>
      <ul className="flex flex-col">
        {items.map((item) => {
          const body = (
            <>
              <span
                aria-hidden="true"
                className={cn('flex size-6 flex-none items-center justify-center rounded-full', item.done ? 'bg-confirm text-white' : 'bg-m-b0 ring-[1.5px] ring-inset ring-m-b4m')}
              >
                {item.done && <MIcon name="check" size={12} stroke={2.6} />}
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-px">
                <span className="truncate text-[14px] font-semibold text-m-t1">{item.label}</span>
                <span className="truncate text-[12px] font-medium text-m-t3">{item.detail}</span>
              </span>
              {!item.done && isCommish && <MIcon name="chevronRight" size={12} stroke={2} className="text-m-t5" />}
            </>
          )
          return (
            <li key={item.key} className="border-b border-m-b3 last:border-b-0">
              {isCommish ? (
                <Link href={checklistHref(item.key, leagueId)} className="flex min-h-[52px] items-center gap-3 py-2">
                  {body}
                </Link>
              ) : (
                <div className="flex min-h-[52px] items-center gap-3 py-2">{body}</div>
              )}
            </li>
          )
        })}
      </ul>
      {isCommish && timeSaved && (
        <div className="flex flex-col gap-1.5">
          <button type="button" onClick={schedule} disabled={setStatus.isPending} className={cn(PRIMARY, 'w-fit')}>
            {setStatus.isPending ? 'Scheduling…' : 'Schedule the draft'}
          </button>
          <p className={NOTE}>Locks in draft night: the countdown appears for every manager and the draft starts automatically at the scheduled time.</p>
        </div>
      )}
      <div className="flex flex-col gap-1.5">
        <PracticeLink leagueId={leagueId} />
        <p className={NOTE}>Test these settings against CPU opponents before draft night.</p>
      </div>
      <div className="flex flex-col gap-1.5">
        <DraftListButton leagueId={leagueId} leagueName={detail.league.name} scoringSystemId={detail.league.scoring_system_id} className="w-fit" />
        <p className={NOTE}>Attach one of your ranking lists — it’s one tap away in the draft room and can feed your autopick.</p>
      </div>
    </section>
  )
}

function ScheduledCards({ leagueId, detail }: { leagueId: string; detail: LeagueDetail }) {
  const scheduledAt = detail.settings.draft.draft_scheduled_at
  const timeZone = detail.settings.draft.time_zone
  const roomEntry = useRoomEntryTarget()
  const templates = useScoringTemplates()
  const templateName = templates.data?.find((t) => t.id === detail.league.scoring_system_id)?.name ?? null
  return (
    <>
      <section className={CARD} aria-label="Draft countdown">
        <h2 className={H}>Draft countdown</h2>
        {scheduledAt ? (
          <Countdown leagueId={leagueId} scheduledAt={scheduledAt} timeZone={timeZone} />
        ) : (
          <p className={NOTE}>A draft time hasn’t been set yet. Add one in League settings.</p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Link href={`/app/leagues/${leagueId}/draft`} {...roomEntry} className={PRIMARY}>
            Enter draft lobby
          </Link>
          <PracticeLink leagueId={leagueId} />
          <DraftListButton leagueId={leagueId} leagueName={detail.league.name} scoringSystemId={detail.league.scoring_system_id} />
        </div>
      </section>
      <section className={cn(CARD, 'flex-row items-center')} aria-label="Scoring">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h2 className={H}>Scoring</h2>
          <span className={NOTE}>{templates.isPending ? 'Reading…' : (templateName ?? 'No scoring template set.')}</span>
        </div>
        <Link href={`/app/leagues/${leagueId}/settings`} className={SECONDARY}>
          Edit
        </Link>
      </section>
      <section className={CARD} aria-label="Draft order">
        <h2 className={H}>Draft order</h2>
        <p className={NOTE}>
          {detail.settings.draft.draft_order_mode === 'random' ? 'Order is randomized when the draft begins.' : 'Order is revealed before the draft begins.'}
        </p>
      </section>
    </>
  )
}

function Countdown({ leagueId, scheduledAt, timeZone }: { leagueId: string; scheduledAt: string; timeZone?: string | null }) {
  // A display clock only (the draft starts on the server's tick).
  const [nowMs, setNowMs] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  // Near the start, re-read the league so the card flips to the live draft.
  const queryClient = useQueryClient()
  const pollMs = autoStartPollMs(scheduledAt, nowMs)
  useEffect(() => {
    if (pollMs === null) return
    const timer = setInterval(() => void queryClient.invalidateQueries({ queryKey: leaguesKeys.detail(leagueId) }), pollMs)
    return () => clearInterval(timer)
  }, [pollMs, leagueId, queryClient])

  const cd = draftCountdown(scheduledAt, nowMs)
  const display = describeDraftTime(scheduledAt, timeZone)
  if (!cd || !display) return <p className={NOTE}>Draft time unavailable.</p>
  return (
    <div className="flex flex-col gap-2.5">
      {cd.isPast ? (
        <span className="w-fit rounded-pill bg-m-gg px-2.5 py-1 text-[12px] font-semibold text-m-tg">Draft window reached</span>
      ) : (
        <div className="flex items-end gap-4">
          {(
            [
              [cd.days, 'days'],
              [cd.hours, 'hrs'],
              [cd.minutes, 'min'],
              [cd.seconds, 'sec'],
            ] as const
          ).map(([v, l]) => (
            <div key={l} className="flex flex-col items-center">
              <span className="text-[28px] font-semibold leading-none tracking-[-0.03em] tabular-nums text-m-t1">{String(v).padStart(2, '0')}</span>
              <span className="mt-1 text-[11px] font-semibold text-m-t3">{l}</span>
            </div>
          ))}
        </div>
      )}
      <div className="flex flex-col gap-0.5 text-[12px] font-medium text-m-t3">
        <span>
          Your time ·{' '}
          <span className="tabular-nums text-m-t1">
            {new Date(cd.targetMs).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
          </span>
        </span>
        <span title="League reference time">
          League time · <span className="tabular-nums text-m-t1">{display.leagueTime}</span>
          {display.leagueOffset && <span> ({display.leagueOffset})</span>}
        </span>
      </div>
    </div>
  )
}

function DraftingCard({ leagueId, detail }: { leagueId: string; detail: LeagueDetail }) {
  const startedAt = detail.active_draft?.started_at ?? null
  const roomEntry = useRoomEntryTarget()
  return (
    <section className="flex flex-col items-center gap-3 rounded-[16px] bg-m-b1 px-4 py-8 text-center" aria-label="Live draft">
      <span className="flex items-center gap-1.5 rounded-pill bg-m-gg px-2.5 py-1 text-[12px] font-semibold text-m-tg">
        <span className="size-1.5 animate-pulse rounded-full bg-current" aria-hidden="true" />
        LIVE
      </span>
      <span className="text-[19px] font-semibold tracking-[-0.02em] text-m-t1">The draft is live</span>
      <span className="text-[13px] font-medium text-m-t3">
        {startedAt
          ? `Picks are coming off the board — the room opened at ${new Date(startedAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}.`
          : 'Picks are coming off the board right now.'}
      </span>
      <Link href={`/app/leagues/${leagueId}/draft`} {...roomEntry} className={PRIMARY}>
        Join draft
      </Link>
    </section>
  )
}

/** The practice drafts you kept or paused (the launcher's own rows). */
function PracticeDraftsCard({ leagueId, detail }: { leagueId: string; detail: LeagueDetail }) {
  const mocks = useMockDrafts(leagueId)
  const roomEntry = useRoomEntryTarget()
  const active = mocks.data?.active ?? []
  const recaps = mocks.data?.recaps ?? []
  if (active.length === 0 && recaps.length === 0) return null
  return (
    <section className={CARD} aria-label="Your practice drafts">
      <h2 className={H}>Your practice drafts</h2>
      <div className="flex flex-col">
        {[...active, ...recaps].map((row) => (
          <PracticeRow
            key={row.id}
            leagueId={leagueId}
            openBlocked={leagueMockOpenBlocked(row, featureFlags.mockDrafts)}
            seatCount={mockSeatCount(row, detail.teams)}
            row={row}
            roomEntry={roomEntry}
          />
        ))}
      </div>
      {active.length > 0 && <p className={NOTE}>{MOCK_EXPIRY_NOTE}</p>}
    </section>
  )
}
