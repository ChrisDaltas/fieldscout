'use client'

import Link from 'next/link'

import { PageHeader } from '@/components/layout/app-header'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Icon } from '@/components/ui/icon'
import { Skeleton } from '@/components/ui/skeleton'
import { useCommishLog } from '@/hooks/use-commish-log'
import { useCommishSummary } from '@/hooks/use-commish-summary'
import { useLeague, type LeagueDetail } from '@/hooks/use-league'
import { useRoomEntryTarget } from '@/hooks/use-room-entry-target'
import type { CommishSummary } from '@/lib/leagues/api/commish-summary-service'
import { useCommishOverrideStore, useOverrideMode } from '@/stores/commish-override-store'

import { CommishLogSection } from './activity-feed'
import {
  CONSOLE_TITLE,
  CORRECTIONS_HINT,
  CORRECTIONS_TITLE,
  NEEDS_PROBLEM_COPY,
  NEEDS_TITLE,
  NOT_COMMISSIONER_COPY,
  OVERRIDE_OFF_COPY,
  OVERRIDE_ON_COPY,
  RECENT_LIMIT,
  RECENT_MORE_LABEL,
  RECENT_TITLE,
  TOOLS_AFTER_DRAFT_NOTE,
  TOOLS_TITLE,
  afterDraft,
  consolePhase,
  correctionsView,
  needsYouView,
  recentMoreHref,
  toolGroups,
  type ConsoleDoor,
  type ConsolePhase,
  type NeedsItem,
  type ToolGroup,
} from './commish-console-ops'
import { teamPageHref } from './league-cells'
import { formatInstantWithDate } from './lineup-editor-ops'
import { OverrideModeBar } from './override-mode-bar'
import { StaleDataBanner, StatusBanner, STALE_LEAGUE_COPY } from './status-banners'
import { problemCopy } from './team-page'

/**
 * The Commissioner Console — M6 task L.E1.33 (`/app/leagues/[id]/commish`;
 * spec §10.1 as folded by v2.16.77; PROGRESS Q87 → D443 (TD11), D446, D455,
 * F535; D457 is this build's note).
 *
 * **A launchpad, not a second copy of the tools.** Four blocks, top to
 * bottom: the override-mode switch (the ONE `OverrideModeBar` over the ONE
 * store — turning it on here is the same as turning it on anywhere);
 * **Needs you** (`GET …/commish/summary`, rendered by `needsYouView` /
 * `correctionsView` — every item the server's, each with one door to the
 * screen that fixes it, or its reason in words and no door); **Tools** (one
 * group per kind of tool, each a door — `toolGroups`); **Recent actions**
 * (his last five, through League Home's own log renderer, TD12).
 *
 * **Every door turns override mode on as it is followed** (`ConsoleDoorLink`
 * calls the store's `enter` in its click handler, then Next navigates on
 * the client — the store is in memory and survives the route change), so
 * he lands on the team / matchup / trade / settings screen ready to act.
 * The store holds no authority; every screen still gates on his role and
 * the server decides every verb.
 *
 * **Commissioners only.** The page's server component redirects anyone else
 * to the league page before this mounts; this component still reads the
 * role and, if it changed under an open page, says so instead of mounting
 * the commissioner-only read (`useCommishSummary(leagueId, enabled)`).
 *
 * §16.5.4: skeleton · empty by reason ("nothing needs you" only when every
 * section answered — F535(a)) · error-with-retry (a failed summary is never
 * the empty state) · degraded (the stale banner over the last good list).
 * No `dark:`; nothing elevated at rest — doors are buttons, whose lift is a
 * hover state (CLAUDE.md).
 */
export function CommishConsole({ leagueId }: { leagueId: string }) {
  const league = useLeague(leagueId)
  const isCommish = league.data?.my_role === 'commissioner' || league.data?.my_role === 'co_commissioner'
  // Mounted for commissioners only (the hook's `enabled` — D455(7) R1363).
  const summary = useCommishSummary(leagueId, isCommish)

  if (league.isPending) return <ConsoleSkeleton />
  if (league.isError || !league.data) {
    return (
      <div className="flex flex-col gap-4" data-commish-console="error">
        <PageHeader title={CONSOLE_TITLE} />
        <Problem title="Couldn’t load this league." detail={league.error ? problemCopy(league.error) : null} onRetry={() => void league.refetch()} />
      </div>
    )
  }
  if (!isCommish) {
    return (
      <div className="flex flex-col gap-4" data-commish-console="not-commissioner">
        <PageHeader title={CONSOLE_TITLE} />
        <StatusBanner tone="neutral">{NOT_COMMISSIONER_COPY}</StatusBanner>
        <div>
          <Button variant="stroke" size="sm" asChild>
            <Link href={`/app/leagues/${leagueId}`}>Back to the league</Link>
          </Button>
        </div>
      </div>
    )
  }
  return <ConsoleContent leagueId={leagueId} data={league.data} summary={summary} />
}

function ConsoleContent({
  leagueId,
  data,
  summary,
}: {
  leagueId: string
  data: LeagueDetail
  summary: ReturnType<typeof useCommishSummary>
}) {
  const phase = consolePhase(data.league.status)
  const overrideOn = useOverrideMode(leagueId)
  const enter = useCommishOverrideStore((s) => s.enter)
  const exit = useCommishOverrideStore((s) => s.exit)
  const log = useCommishLog(leagueId, { limit: RECENT_LIMIT })
  const newest = log.data?.pages[0]
  const teamNames = new Map(data.teams.map((t) => [t.id, t.name]))
  const leagueTimeZone = data.settings.draft.time_zone ?? null
  const more = recentMoreHref(leagueId, phase)

  return (
    <div className="flex flex-col gap-4" data-commish-console={phase}>
      <PageHeader
        title={CONSOLE_TITLE}
        actions={
          <Button variant="stroke" size="sm" asChild>
            <Link href={`/app/leagues/${leagueId}`}>
              <Icon name="cup" size={13} />
              {data.league.name}
            </Link>
          </Button>
        }
      />

      <OverrideModeBar on={overrideOn} onToggle={(next) => (next ? enter(leagueId) : exit())}>
        {overrideOn ? OVERRIDE_ON_COPY : OVERRIDE_OFF_COPY}
      </OverrideModeBar>

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <NeedsYouCard leagueId={leagueId} phase={phase} summary={summary} leagueTimeZone={leagueTimeZone} />
        <ToolsCard leagueId={leagueId} phase={phase} data={data} />
      </div>

      <Card data-commish-recent>
        <CardContent className="flex flex-col gap-2 px-card-pad py-3">
          <CommishLogSection
            title={RECENT_TITLE}
            className="border-t-0 pt-0"
            items={newest?.items}
            pending={log.isPending}
            problem={log.isError ? log.error : null}
            onRetry={() => void log.refetch()}
            hasMore={newest?.has_more ?? false}
            teamNames={teamNames}
            leagueTimeZone={leagueTimeZone}
          />
          {more && (
            <div>
              <Button variant="stroke" size="sm" asChild>
                <Link href={more} data-commish-recent-more>
                  {RECENT_MORE_LABEL}
                </Link>
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

// ---------------------------------------------------------------------------
// A door — a link that turns override mode on as it is followed
// ---------------------------------------------------------------------------

function ConsoleDoorLink({
  leagueId,
  door,
  variant = 'stroke',
  ...rest
}: {
  leagueId: string
  door: ConsoleDoor
  variant?: 'stroke' | 'blue'
} & Record<`data-${string}`, string>) {
  const enter = useCommishOverrideStore((s) => s.enter)
  // DR.6: a door INTO the draft room takes the platform split (a new tab on
  // a measured desktop, in place elsewhere) — room-entry.test.ts pins it.
  const roomEntry = useRoomEntryTarget()
  return (
    <Button variant={variant} size="sm" asChild>
      <Link href={door.href} onClick={() => enter(leagueId)} data-override-door="on" {...(door.room ? roomEntry : {})} {...rest}>
        {door.label}
      </Link>
    </Button>
  )
}

// ---------------------------------------------------------------------------
// Needs you
// ---------------------------------------------------------------------------

function NeedsYouCard({
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
  return (
    <Card data-commish-needs>
      <CardHeader className="min-h-0 py-2">
        <CardTitle className="text-[12px]">{NEEDS_TITLE}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 px-card-pad py-3">
        {summary.isError && doc && <StaleDataBanner>{STALE_LEAGUE_COPY}</StaleDataBanner>}
        {summary.isPending && !doc ? (
          <div className="flex flex-col gap-1.5" data-skeleton="commish-needs">
            {Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} className="h-10 rounded-sm" />
            ))}
          </div>
        ) : !doc ? (
          // A FAILED read is never "nothing needs you" (CLAUDE.md; F535(a)).
          <Problem title={NEEDS_PROBLEM_COPY} detail={summary.error ? problemCopy(summary.error) : null} onRetry={() => void summary.refetch()} inline />
        ) : (
          <NeedsYouList leagueId={leagueId} phase={phase} doc={doc} leagueTimeZone={leagueTimeZone} />
        )}
      </CardContent>
    </Card>
  )
}

function NeedsYouList({
  leagueId,
  phase,
  doc,
  leagueTimeZone,
}: {
  leagueId: string
  phase: ConsolePhase
  doc: CommishSummary
  leagueTimeZone: string | null
}) {
  const view = needsYouView(leagueId, phase, doc.sections, (iso) => formatInstantWithDate(iso, leagueTimeZone).local)
  const corrections = correctionsView(leagueId, doc.sections.matchup_corrections)
  return (
    <>
      {view.unavailable.map((u) => (
        <div key={u.key} data-needs-unavailable={u.key}>
          <StatusBanner tone="caution">{u.message}</StatusBanner>
        </div>
      ))}
      {view.nothing && (
        <p className="text-[12px] font-medium text-n-3" data-empty="commish-needs">
          {view.nothingCopy}
        </p>
      )}
      {view.items.length > 0 && (
        <ol className="flex flex-col divide-y divide-n-4" data-needs-items>
          {view.items.map((item) => (
            <NeedsRow key={item.key} leagueId={leagueId} item={item} />
          ))}
        </ol>
      )}

      {corrections.kind !== 'hidden' && (
        <section className="flex flex-col gap-2 border-t border-ink pt-3" aria-label={CORRECTIONS_TITLE} data-commish-corrections>
          <h3 className="text-[12px] font-bold text-ink">{CORRECTIONS_TITLE}</h3>
          {corrections.kind === 'unavailable' ? (
            <div data-needs-unavailable="matchup_corrections">
              <StatusBanner tone="caution">{corrections.message}</StatusBanner>
            </div>
          ) : (
            <>
              <p className="text-[11px] font-medium text-n-3">{CORRECTIONS_HINT}</p>
              <ol className="flex flex-col divide-y divide-n-4">
                {corrections.rows.map((row) => (
                  <li key={row.key} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2" data-correction-row={row.door ? 'now' : 'not-yet'}>
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="text-[12px] font-bold text-ink">
                        Week <span className="fs-num">{row.week}</span> · {row.label}
                      </span>
                      {row.message && (
                        <span className="text-[11px] font-medium text-n-3" data-correction-why>
                          {row.message}
                        </span>
                      )}
                    </div>
                    {row.door && <ConsoleDoorLink leagueId={leagueId} door={row.door} data-correction-door="score" />}
                  </li>
                ))}
              </ol>
            </>
          )}
        </section>
      )}
    </>
  )
}

function NeedsRow({ leagueId, item }: { leagueId: string; item: NeedsItem }) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2" data-needs-item={item.kind}>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-[12px] font-bold text-ink" data-needs-text>
          {item.text}
        </span>
        <span className="text-[11px] font-medium text-n-3">{item.hint}</span>
      </div>
      {item.door && <ConsoleDoorLink leagueId={leagueId} door={item.door} variant="blue" data-needs-door={item.kind} />}
    </li>
  )
}

// ---------------------------------------------------------------------------
// Tools — one door per kind of tool
// ---------------------------------------------------------------------------

function ToolsCard({ leagueId, phase, data }: { leagueId: string; phase: ConsolePhase; data: LeagueDetail }) {
  const groups = toolGroups({ leagueId, phase, waiverType: data.settings.waiver_type })
  return (
    <Card data-commish-tools-groups>
      <CardHeader className="min-h-0 py-2">
        <CardTitle className="text-[12px]">{TOOLS_TITLE}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col divide-y divide-n-4 px-card-pad py-1">
        {groups.map((group) => (
          <ToolGroupRow key={group.key} leagueId={leagueId} group={group} data={data} />
        ))}
        {!afterDraft(phase) && phase !== 'other' && (
          <p className="py-2.5 text-[11px] font-medium text-n-3" data-tools-after-draft>
            {TOOLS_AFTER_DRAFT_NOTE}
          </p>
        )}
      </CardContent>
    </Card>
  )
}

function ToolGroupRow({ leagueId, group, data }: { leagueId: string; group: ToolGroup; data: LeagueDetail }) {
  // Retired franchises play no more weeks (139's seat rule) — their pages are
  // history, not a place to act.
  const teams = group.teamDoors ? data.teams.filter((t) => t.status !== 'retired') : []
  return (
    <section className="flex flex-col gap-1.5 py-2.5" aria-label={group.title} data-tool-group={group.key}>
      <h3 className="text-[12px] font-bold text-ink">{group.title}</h3>
      <p className="text-[11px] font-medium text-n-3">{group.blurb}</p>
      {(group.doors.length > 0 || teams.length > 0) && (
        <div className="flex flex-wrap gap-2">
          {group.doors.map((door) => (
            <ConsoleDoorLink key={door.href + door.label} leagueId={leagueId} door={door} data-tool-door={group.key} />
          ))}
          {teams.map((team) => (
            <ConsoleDoorLink
              key={team.id}
              leagueId={leagueId}
              door={{ label: team.name, href: teamPageHref(leagueId, team.id) }}
              data-tool-door="team"
            />
          ))}
        </div>
      )}
      {group.note && (
        <p className="text-[11px] font-medium text-n-3" data-tool-note={group.key}>
          {group.note}
        </p>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------
// Shared states (§16.5.4)
// ---------------------------------------------------------------------------

function ConsoleSkeleton() {
  return (
    <div className="flex flex-col gap-4" data-commish-console="loading">
      <PageHeader title={CONSOLE_TITLE} />
      <Skeleton className="h-12 rounded-sm" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Skeleton className="h-48 rounded-sm" />
        <Skeleton className="h-48 rounded-sm" />
      </div>
      <Skeleton className="h-32 rounded-sm" />
    </div>
  )
}

function Problem({
  title,
  detail,
  onRetry,
  inline = false,
}: {
  title: string
  detail: string | null
  onRetry: () => void
  inline?: boolean
}) {
  const body = (
    <div className="flex flex-col items-start gap-2 rounded-sm border border-negative bg-negative-soft px-3 py-2" role="alert" data-problem>
      <p className="text-[12px] font-bold">{title}</p>
      {detail && <p className="text-[11px] font-medium text-n-3">{detail}</p>}
      <Button variant="stroke" size="sm" onClick={onRetry}>
        <Icon name="reset" size={13} /> Retry
      </Button>
    </div>
  )
  return inline ? body : <Card className="border-0 p-0">{body}</Card>
}
