'use client'

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'

import { COMMISH_LOG_EMPTY_COPY, COMMISH_LOG_PROBLEM_COPY, commishLogLines, groupCommishLogLines, memberNamesOf } from '@/components/leagues/activity-feed-ops'
import {
  CORRECTIONS_HINT,
  CORRECTIONS_TITLE,
  NEEDS_PROBLEM_COPY,
  NEEDS_STALE_COPY,
  NEEDS_TITLE,
  NOT_COMMISSIONER_COPY,
  OVERRIDE_OFF_COPY,
  RECENT_LIMIT,
  RECENT_MORE_LABEL,
  RECENT_TITLE,
  TOOLS_AFTER_DRAFT_NOTE,
  TOOLS_TITLE,
  afterDraft,
  consolePhase,
  correctionsView,
  needsYouView,
  toolGroups,
  type ConsoleDoor,
  type ConsolePhase,
  type NeedsItem,
  type ToolGroup,
} from '@/components/leagues/commish-console-ops'
import { REPAIR_NEEDS_OVERRIDE_COPY, REPAIR_NOTHING_COPY, REPAIR_TITLE, repairOptions } from '@/components/leagues/commish-repair-ops'
import { teamPageHref } from '@/components/leagues/league-cells'
import { formatInstantWithDate } from '@/components/leagues/lineup-editor-ops'
import {
  REMIX_NEEDS_OVERRIDE_COPY,
  SCHEDULE_EDIT_NONE_COPY,
  SCHEDULE_EDIT_TITLE,
  editableTeams,
  remixSeasonStarted,
  scheduleEditWeeks,
  type MatchupCell,
} from '@/components/leagues/schedule-view-ops'
import { CommishLogRow } from '@/components/mobile/league/league/activity-subscreens'
import { CenteredNote, LeaguePageBar, PageChip, SkeletonBlocks } from '@/components/mobile/league/league/league-bits'
import { commishLogHref } from '@/components/mobile/league/league/league-tab-ops'
import { TeamAvatar } from '@/components/mobile/league/team/team-avatar'
import { teamOrder } from '@/components/mobile/league/team/team-ops'
import { MNotice } from '@/components/mobile/ui/m-form'
import { MIcon } from '@/components/mobile/ui/m-icon'
import { MobileScreen } from '@/components/mobile/ui/mobile-header'
import { useAuth } from '@/hooks/use-auth'
import { useCommishLog } from '@/hooks/use-commish-log'
import { useCommishSummary } from '@/hooks/use-commish-summary'
import { useLeague, type LeagueDetail } from '@/hooks/use-league'
import { useRoomEntryTarget } from '@/hooks/use-room-entry-target'
import { useSchedule } from '@/hooks/use-schedule'
import type { CommishSummary } from '@/lib/leagues/api/commish-summary-service'
import { cn } from '@/lib/utils'
import { useCommishOverrideStore, useOverrideMode } from '@/stores/commish-override-store'

import {
  COMMISH_TOOLS_TITLE,
  OVERRIDE_ON_NOTE,
  REMIX_ROW_LABEL,
  REMIX_ROW_NOTE,
  REPAIR_ROW_NOTE,
  SCHEDULE_EDIT_ANCHOR,
  editWeek,
  wantsScheduleEdit,
} from './commish-ops'
import { EditMatchupSheet, RemixSheet, RepairSheet } from './schedule-sheets'

/**
 * League Menu › Commissioner tools on the phone (gap list §4 item 109) — the
 * phone's screen for `/commish`, on the same reads, rules and doors as
 * desktop's `CommishConsole`, which is unchanged. The page's server
 * component still decides who may open it (commissioners only). The handoff
 * draws no commissioner page, so it extends the G pages (League settings,
 * Members): the 52px bar, 13/600 t3 section titles and b1 cards of rows.
 *
 * Top to bottom, as on desktop:
 *  - **Override mode** — off, what it does and the pill that turns it on;
 *    on, the bar's green strip says so (with Turn off) and a line says what
 *    it means. ONE store: on here is on everywhere.
 *  - **Needs you** — the server's list (`GET …/commish/summary`), each item
 *    in words with its one door, or no door when no screen would accept the
 *    fix; then **Correcting scores** — the matchups that can be corrected
 *    now (a door each) and the ones that must wait (the server's sentence).
 *  - **Tools** — a card per kind of tool (`toolGroups`): the screens it
 *    opens as rows, every team as a row under Lineups & rosters. In season
 *    the Schedule card also holds the schedule changes themselves, as
 *    sheets: change an upcoming week's matchup, remix the schedule (once
 *    the season has started, only in override mode — said, never refused),
 *    and re-pair a matchup (override mode).
 *  - **Recent actions** — his last few, on the commissioner log's own rows,
 *    with See all.
 *
 * Every door to a screen that acts turns override mode on as it is followed,
 * so he lands ready to act; a view-only door doesn't. A door into the draft
 * room takes the room's entry split. States: skeleton, "Couldn’t load…"
 * with Try again, a failed or stale "Needs you" said (never "nothing needs
 * you"), and the role changing under an open page. Back goes to where you
 * came from, else the League tab. Cards rest flat (no shadow).
 */
export function MobileCommishConsole({ leagueId }: { leagueId: string }) {
  const league = useLeague(leagueId)
  const isCommish = league.data?.my_role === 'commissioner' || league.data?.my_role === 'co_commissioner'
  // Mounted for commissioners only (the hook's `enabled`).
  const summary = useCommishSummary(leagueId, isCommish)
  const header = <LeaguePageBar leagueId={leagueId} title={COMMISH_TOOLS_TITLE} />
  if (league.isPending) {
    return (
      <MobileScreen header={header}>
        <div className="px-4 pt-3" data-commish-console="loading">
          <SkeletonBlocks count={4} className="h-24" />
        </div>
      </MobileScreen>
    )
  }
  if (league.isError || !league.data) {
    return (
      <MobileScreen header={header}>
        <div data-commish-console="error">
          <CenteredNote role="alert" message="Couldn’t load this league." action="Try again" onAction={() => void league.refetch()} />
        </div>
      </MobileScreen>
    )
  }
  if (!isCommish) {
    return (
      <MobileScreen header={header}>
        <div data-commish-console="not-commissioner">
          <CenteredNote role="status" message={NOT_COMMISSIONER_COPY} />
        </div>
      </MobileScreen>
    )
  }
  return <ConsoleScreen leagueId={leagueId} detail={league.data} summary={summary} header={header} />
}

const SECTION_TITLE = 'text-[13px] font-semibold text-m-t3'
const NOTE = 'text-[12px] font-medium leading-[1.35] text-m-t3'
const ROW = 'flex min-h-[52px] items-center gap-3 border-b border-m-b3 py-2.5 last:border-b-0'

function ConsoleScreen({
  leagueId,
  detail,
  summary,
  header,
}: {
  leagueId: string
  detail: LeagueDetail
  summary: ReturnType<typeof useCommishSummary>
  header: React.ReactNode
}) {
  const phase = consolePhase(detail.league.status)
  const overrideOn = useOverrideMode(leagueId)
  const enter = useCommishOverrideStore((s) => s.enter)
  const leagueTimeZone = detail.settings.draft.time_zone ?? null
  const { user } = useAuth()
  const myTeamId = detail.members.find((m) => m.user_id && m.user_id === user?.id)?.team_id ?? null
  return (
    <MobileScreen header={header}>
      <div className="flex flex-col gap-[18px] px-4 pb-8 pt-3" data-commish-console={phase}>
        {overrideOn ? (
          <p className={cn(NOTE, 'px-1')} data-commish-override="on">
            {OVERRIDE_ON_NOTE}
          </p>
        ) : (
          <div className="flex flex-col items-start gap-2.5 rounded-message bg-m-b1 px-3.5 py-3" data-commish-override="off">
            <p className="text-[13px] font-medium leading-[1.45] text-m-t2">{OVERRIDE_OFF_COPY}</p>
            <button
              type="button"
              onClick={() => enter(leagueId)}
              aria-pressed={false}
              className="flex h-9 items-center rounded-pill bg-accent px-4 text-[13px] font-semibold text-white active:bg-accent-strong"
              data-override-toggle="off"
            >
              Turn on override mode
            </button>
          </div>
        )}

        <NeedsYou leagueId={leagueId} phase={phase} summary={summary} leagueTimeZone={leagueTimeZone} />
        <Tools leagueId={leagueId} phase={phase} detail={detail} myTeamId={myTeamId} summarySettled={!summary.isPending} />
        <RecentActions leagueId={leagueId} detail={detail} />
      </div>
    </MobileScreen>
  )
}

function SectionHead({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 px-1 pb-1.5">
      <h2 className={SECTION_TITLE}>{title}</h2>
      {action}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Doors — links that turn override mode on as they are followed
// ---------------------------------------------------------------------------

function useDoorProps(leagueId: string, door: ConsoleDoor) {
  const enter = useCommishOverrideStore((s) => s.enter)
  // A door INTO the draft room takes the room's entry split (a new tab on a
  // measured desktop, in place on a phone) — room-entry.test.ts pins it.
  const roomEntry = useRoomEntryTarget()
  return {
    href: door.href,
    // A view-only door (nothing on that screen acts in this state) does not
    // switch override mode on.
    onClick: door.view ? undefined : () => enter(leagueId),
    'data-override-door': door.view ? 'view' : 'on',
    ...(door.room ? roomEntry : {}),
  }
}

/** A door as a compact pill at a row's end (Needs you, Correcting scores). */
function DoorPill({ leagueId, door, tone = 'blue', ...rest }: { leagueId: string; door: ConsoleDoor; tone?: 'blue' | 'quiet' } & Record<`data-${string}`, string>) {
  const props = useDoorProps(leagueId, door)
  return (
    <Link
      {...props}
      {...rest}
      className={cn(
        'flex h-8 flex-none items-center whitespace-nowrap rounded-pill px-3 text-[13px] font-semibold',
        tone === 'blue' ? 'bg-accent text-white active:bg-accent-strong' : 'bg-m-b0 text-m-t1 active:bg-m-b2',
      )}
    >
      {door.label}
    </Link>
  )
}

/** A door as a card row with a chevron (Tools). `leading` puts a team's
 *  avatar before the label. */
function DoorRow({
  leagueId,
  door,
  leading,
  ...rest
}: { leagueId: string; door: ConsoleDoor; leading?: React.ReactNode } & Record<`data-${string}`, string>) {
  const props = useDoorProps(leagueId, door)
  return (
    <li className="border-b border-m-b3 last:border-b-0">
      <Link {...props} {...rest} className="flex min-h-12 items-center gap-3 py-2 active:opacity-70">
        {leading}
        <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-m-t1">{door.label}</span>
        <MIcon name="chevronRight" size={12} stroke={2} className="text-m-t5" />
      </Link>
    </li>
  )
}

// ---------------------------------------------------------------------------
// Needs you, and Correcting scores
// ---------------------------------------------------------------------------

function NeedsYou({
  leagueId,
  phase,
  summary,
  leagueTimeZone,
}: {
  leagueId: string
  phase: ConsolePhase
  summary: ReturnType<typeof useCommishSummary>
  leagueTimeZone: string | null
}) {
  const doc: CommishSummary | undefined = summary.data
  const retry = () => void summary.refetch()
  return (
    <>
      <section className="flex flex-col" aria-label={NEEDS_TITLE} data-commish-needs>
        <SectionHead title={NEEDS_TITLE} />
        {summary.isError && doc && (
          // The last good list stays, and says it isn't refreshing.
          <div className="pb-2" data-needs-stale>
            <MNotice tone="warning" action={{ label: 'Try again', onClick: retry }}>
              {NEEDS_STALE_COPY}
            </MNotice>
          </div>
        )}
        {summary.isPending && !doc ? (
          <div data-skeleton="commish-needs">
            <SkeletonBlocks count={2} className="h-16" />
          </div>
        ) : !doc ? (
          // A FAILED read is never "nothing needs you".
          <MNotice tone="error" action={{ label: 'Try again', onClick: retry }}>
            {NEEDS_PROBLEM_COPY}
          </MNotice>
        ) : (
          <NeedsList leagueId={leagueId} phase={phase} doc={doc} leagueTimeZone={leagueTimeZone} />
        )}
      </section>
      {doc && <Corrections leagueId={leagueId} doc={doc} />}
    </>
  )
}

function NeedsList({ leagueId, phase, doc, leagueTimeZone }: { leagueId: string; phase: ConsolePhase; doc: CommishSummary; leagueTimeZone: string | null }) {
  const view = needsYouView(leagueId, phase, doc.sections, (iso) => formatInstantWithDate(iso, leagueTimeZone).local)
  return (
    <div className="flex flex-col gap-2">
      {view.unavailable.map((u) => (
        <div key={u.key} data-needs-unavailable={u.key}>
          <MNotice tone="warning">{u.message}</MNotice>
        </div>
      ))}
      {view.nothing && (
        <p className="rounded-[16px] bg-m-b1 px-3.5 py-3.5 text-[13px] font-medium leading-[1.4] text-m-t3" data-empty="commish-needs">
          {view.nothingCopy}
        </p>
      )}
      {view.items.length > 0 && (
        <ul className="flex flex-col rounded-[16px] bg-m-b1 px-3.5" data-needs-items>
          {view.items.map((item) => (
            <NeedsRow key={item.key} leagueId={leagueId} item={item} />
          ))}
        </ul>
      )}
    </div>
  )
}

function NeedsRow({ leagueId, item }: { leagueId: string; item: NeedsItem }) {
  return (
    <li className={ROW} data-needs-item={item.kind}>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-[14px] font-semibold leading-[1.35] text-m-t1" data-needs-text>
          {item.text}
        </span>
        <span className={NOTE}>{item.hint}</span>
      </span>
      {item.door && <DoorPill leagueId={leagueId} door={item.door} data-needs-door={item.kind} />}
    </li>
  )
}

function Corrections({ leagueId, doc }: { leagueId: string; doc: CommishSummary }) {
  const view = correctionsView(leagueId, doc.sections.matchup_corrections)
  if (view.kind === 'hidden') return null
  return (
    <section className="flex flex-col" aria-label={CORRECTIONS_TITLE} data-commish-corrections>
      <SectionHead title={CORRECTIONS_TITLE} />
      {view.kind === 'unavailable' ? (
        <div data-needs-unavailable="matchup_corrections">
          <MNotice tone="warning">{view.message}</MNotice>
        </div>
      ) : (
        <>
          <p className={cn(NOTE, 'px-1 pb-2')}>{CORRECTIONS_HINT}</p>
          <ul className="flex flex-col rounded-[16px] bg-m-b1 px-3.5">
            {view.rows.map((row) => (
              <li key={row.key} className={ROW} data-correction-row={row.door ? 'now' : 'not-yet'}>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-[14px] font-semibold leading-[1.35] text-m-t1">
                    <span className="tabular-nums">Week {row.week}</span> · {row.label}
                  </span>
                  {row.message && (
                    <span className={NOTE} data-correction-why>
                      {row.message}
                    </span>
                  )}
                </span>
                {row.door && <DoorPill leagueId={leagueId} door={row.door} tone="quiet" data-correction-door="score" />}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

function Tools({
  leagueId,
  phase,
  detail,
  myTeamId,
  summarySettled,
}: {
  leagueId: string
  phase: ConsolePhase
  detail: LeagueDetail
  myTeamId: string | null
  summarySettled: boolean
}) {
  const groups = toolGroups({ leagueId, phase, waiverType: detail.settings.waiver_type })
  return (
    <section className="flex flex-col" aria-label={TOOLS_TITLE} data-commish-tools-groups>
      <SectionHead title={TOOLS_TITLE} />
      <div className="flex flex-col gap-2.5">
        {groups.map((group) => (
          <ToolCard key={group.key} leagueId={leagueId} group={group} detail={detail} phase={phase} myTeamId={myTeamId} summarySettled={summarySettled} />
        ))}
      </div>
      {!afterDraft(phase) && phase !== 'other' && (
        <p className={cn(NOTE, 'px-1 pt-2')} data-tools-after-draft>
          {TOOLS_AFTER_DRAFT_NOTE}
        </p>
      )}
    </section>
  )
}

function ToolCard({
  leagueId,
  group,
  detail,
  phase,
  myTeamId,
  summarySettled,
}: {
  leagueId: string
  group: ToolGroup
  detail: LeagueDetail
  phase: ConsolePhase
  myTeamId: string | null
  summarySettled: boolean
}) {
  // No team is ever retired since 176 — every team has a door.
  const teams = group.teamDoors ? detail.teams : []
  const order = teamOrder(detail.teams)
  const inSeasonSchedule = group.key === 'schedule' && phase === 'in_season'
  return (
    <section
      className={cn('flex flex-col rounded-[16px] bg-m-b1 px-3.5', !group.note && !inSeasonSchedule && 'pb-1')}
      aria-label={group.title}
      data-tool-group={group.key}
    >
      <div className="flex flex-col gap-0.5 py-3">
        <h3 className="text-[15px] font-semibold text-m-t1">{group.title}</h3>
        <p className={NOTE}>{group.blurb}</p>
      </div>
      {(group.doors.length > 0 || teams.length > 0) && (
        <ul className="flex flex-col border-t border-m-b3">
          {group.doors.map((door) => (
            <DoorRow key={door.href + door.label} leagueId={leagueId} door={door} data-tool-door={group.key} />
          ))}
          {teams.map((team) => (
            <DoorRow
              key={team.id}
              leagueId={leagueId}
              door={{ label: team.name, href: teamPageHref(leagueId, team.id) }}
              leading={<TeamAvatar teamId={team.id} name={team.name} teamIds={order} myTeamId={myTeamId} size={28} fontSize={11} />}
              data-tool-door="team"
            />
          ))}
        </ul>
      )}
      {inSeasonSchedule && <ScheduleTools leagueId={leagueId} detail={detail} summarySettled={summarySettled} />}
      {group.note && (
        <p className={cn(NOTE, 'border-t border-m-b3 py-3')} data-tool-note={group.key}>
          {group.note}
        </p>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------
// The in-season schedule changes (the console is their only home — F580)
// ---------------------------------------------------------------------------

/** Which sheet is up — a fresh mount per opening (`n`), kept mounted while
 *  it closes so it slides away. */
type SheetKind = { kind: 'edit'; week: number; row: MatchupCell } | { kind: 'remix' } | { kind: 'repair' }
type OpenSheet = SheetKind & { n: number; open: boolean }

function ScheduleTools({ leagueId, detail, summarySettled }: { leagueId: string; detail: LeagueDetail; summarySettled: boolean }) {
  const schedule = useSchedule(leagueId)
  const overrideOn = useOverrideMode(leagueId)
  const { profile } = useAuth()
  const names = useMemo(() => new Map(detail.teams.map((t) => [t.id, t.name])), [detail.teams])
  const teams = useMemo(() => editableTeams(detail.teams), [detail.teams])
  const weeks = useMemo(
    () =>
      schedule.data
        ? scheduleEditWeeks(schedule.data, names, { regular_season_weeks: detail.settings.regular_season_weeks, schedule_mode: detail.settings.schedule_mode })
        : [],
    [schedule.data, names, detail.settings.regular_season_weeks, detail.settings.schedule_mode],
  )
  const [picked, setPicked] = useState<number | null>(null)
  const shown = editWeek(weeks, picked)
  const shownWeek = weeks.find((w) => w.week === shown) ?? null
  const [sheet, setSheet] = useState<OpenSheet | null>(null)
  const open = (next: SheetKind) => setSheet((s) => ({ ...next, n: (s?.n ?? 0) + 1, open: true }))
  const close = (o: boolean) => setSheet((s) => (s ? { ...s, open: o } : s))

  // The member Schedule page's door lands here (`#schedule-edit`): once the
  // page has settled, bring the edit list into view under the sticky bar.
  const anchor = useRef<HTMLDivElement | null>(null)
  const jumped = useRef(false)
  const ready = Boolean(schedule.data) && summarySettled
  useEffect(() => {
    if (!ready || jumped.current || !wantsScheduleEdit(window.location.hash)) return
    jumped.current = true
    const el = anchor.current
    if (!el) return
    const bar = el.closest('[data-mobile-screen]')?.firstElementChild
    const by = el.getBoundingClientRect().top - (bar?.getBoundingClientRect().bottom ?? 0) - 12
    const scroller: Pick<Window, 'scrollBy'> = el.closest('main') ?? window
    scroller.scrollBy({ top: by })
  }, [ready])

  if (schedule.isPending) {
    return (
      <div className="border-t border-m-b3 py-3">
        <div className="h-24 animate-pulse rounded-[12px] bg-m-b2" aria-busy="true" aria-label="Loading" />
      </div>
    )
  }
  if (!schedule.data) {
    return (
      <div className="border-t border-m-b3 py-3">
        <MNotice tone="error" action={{ label: 'Try again', onClick: () => void schedule.refetch() }}>
          Couldn’t load the schedule.
        </MNotice>
      </div>
    )
  }

  const started = remixSeasonStarted(schedule.data.weeks)
  const remixOffered = !started || overrideOn
  const repairable = repairOptions(schedule.data.matchups, names).size > 0
  return (
    <>
      <div ref={anchor} id={SCHEDULE_EDIT_ANCHOR} className="flex flex-col gap-2 border-t border-m-b3 py-3" data-console-schedule-edit={weeks.length > 0 ? 'weeks' : 'none'}>
        <h4 className="text-[14px] font-semibold text-m-t1">{SCHEDULE_EDIT_TITLE}</h4>
        {weeks.length === 0 ? (
          <p className={NOTE}>{SCHEDULE_EDIT_NONE_COPY}</p>
        ) : (
          <>
            {weeks.length > 1 && (
              <div className="-mx-3.5 flex gap-1.5 overflow-x-auto px-3.5 scrollbar-none" role="group" aria-label="Weeks" data-edit-weeks>
                {weeks.map((w) => (
                  <PageChip key={w.week} on={w.week === shown} onClick={() => setPicked(w.week)} className="tabular-nums">
                    Week {w.week}
                  </PageChip>
                ))}
              </div>
            )}
            {shownWeek && (
              <ul className="flex flex-col rounded-[12px] bg-m-b0 px-3" aria-label={`Week ${shownWeek.week} matchups`} data-console-edit-week={shownWeek.week}>
                {shownWeek.rows.map((row) => (
                  <li key={row.id} className="flex min-h-12 items-center gap-2 border-b border-m-b3 py-2 last:border-b-0" data-console-edit-row={row.id}>
                    <span className="min-w-0 flex-1 text-[14px] font-medium leading-[1.35] text-m-t1">
                      {row.home.name} <span className="text-[12px] text-m-t3">vs</span> {row.away?.name}
                    </span>
                    <button
                      type="button"
                      onClick={() => open({ kind: 'edit', week: shownWeek.week, row })}
                      aria-label={`Edit ${row.home.name} vs ${row.away?.name ?? ''}`}
                      aria-haspopup="dialog"
                      className="flex h-8 flex-none items-center rounded-pill bg-m-b2 px-3 text-[13px] font-semibold text-m-t1 active:bg-m-b2h"
                      data-edit-matchup
                    >
                      Edit
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>

      <ActionRow
        label={REMIX_ROW_LABEL}
        note={remixOffered ? REMIX_ROW_NOTE : REMIX_NEEDS_OVERRIDE_COPY}
        disabled={!remixOffered}
        onClick={() => open({ kind: 'remix' })}
        data-console-remix={remixOffered ? 'offered' : 'needs-override'}
      />
      {!overrideOn ? (
        <p className={cn(NOTE, 'border-t border-m-b3 py-3')} data-console-repair="needs-override">
          {REPAIR_NEEDS_OVERRIDE_COPY}
        </p>
      ) : !repairable ? (
        <p className={cn(NOTE, 'border-t border-m-b3 py-3')} data-console-repair="none">
          {REPAIR_NOTHING_COPY}
        </p>
      ) : (
        <ActionRow label={REPAIR_TITLE} note={REPAIR_ROW_NOTE} onClick={() => open({ kind: 'repair' })} data-console-repair="offered" />
      )}

      {sheet?.kind === 'edit' && (
        <EditMatchupSheet key={sheet.n} open={sheet.open} onOpenChange={close} leagueId={leagueId} week={sheet.week} row={sheet.row} teams={teams} />
      )}
      {sheet?.kind === 'remix' && remixOffered && (
        <RemixSheet
          key={sheet.n}
          open={sheet.open}
          onOpenChange={close}
          leagueId={leagueId}
          current={schedule.data.matchups}
          names={names}
          leagueTimeZone={detail.settings.draft.time_zone ?? null}
          actorName={profile?.username ?? 'you'}
        />
      )}
      {sheet?.kind === 'repair' && overrideOn && (
        <RepairSheet key={sheet.n} open={sheet.open} onOpenChange={close} leagueId={leagueId} matchups={schedule.data.matchups} teams={teams} />
      )}
    </>
  )
}

/** A row that opens a sheet: its label, what it does, a chevron. Disabled,
 *  it greys out and its note says how to get it (prevent, don't refuse). */
function ActionRow({
  label,
  note,
  disabled = false,
  onClick,
  ...rest
}: { label: string; note: string; disabled?: boolean; onClick: () => void } & Record<`data-${string}`, string>) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-haspopup="dialog"
      className="flex min-h-[56px] w-full items-center gap-3 border-t border-m-b3 py-2.5 text-left active:opacity-70 disabled:active:opacity-100"
      {...rest}
    >
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className={cn('text-[14px] font-medium', disabled ? 'text-m-t4' : 'text-m-t1')}>{label}</span>
        <span className={NOTE}>{note}</span>
      </span>
      {!disabled && <MIcon name="chevronRight" size={12} stroke={2} className="text-m-t5" />}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Recent actions
// ---------------------------------------------------------------------------

function RecentActions({ leagueId, detail }: { leagueId: string; detail: LeagueDetail }) {
  const log = useCommishLog(leagueId, { limit: RECENT_LIMIT })
  const newest = log.data?.pages[0]
  const teamNames = useMemo(() => new Map(detail.teams.map((t) => [t.id, t.name])), [detail.teams])
  const memberNames = useMemo(() => memberNamesOf(detail.members), [detail.members])
  const groups = useMemo(
    () => (newest ? groupCommishLogLines(newest.items, commishLogLines(newest.items, teamNames, memberNames)) : null),
    [newest, teamNames, memberNames],
  )
  return (
    <section className="flex flex-col" aria-label={RECENT_TITLE} data-commish-recent>
      <SectionHead
        title={RECENT_TITLE}
        action={
          <Link href={commishLogHref(leagueId)} className="text-[13px] font-semibold text-accent" data-commish-recent-more>
            {RECENT_MORE_LABEL}
          </Link>
        }
      />
      {log.isPending ? (
        <SkeletonBlocks count={2} className="h-16" />
      ) : !groups ? (
        <MNotice tone="error" action={{ label: 'Try again', onClick: () => void log.refetch() }}>
          {COMMISH_LOG_PROBLEM_COPY}
        </MNotice>
      ) : groups.length === 0 ? (
        <p className="rounded-[16px] bg-m-b1 px-3.5 py-3.5 text-[13px] font-medium leading-[1.4] text-m-t3" data-empty="commish-recent">
          {COMMISH_LOG_EMPTY_COPY}
        </p>
      ) : (
        <div className="flex flex-col rounded-[16px] bg-m-b1 px-3.5">
          {groups.map(({ line }) => (
            <CommishLogRow key={line.id} leagueId={leagueId} line={line} className="border-b border-m-b3 last:border-b-0" />
          ))}
        </div>
      )}
    </section>
  )
}
