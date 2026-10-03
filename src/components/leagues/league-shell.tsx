'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useMemo, type ReactNode } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Icon } from '@/components/ui/icon'
import { segmentItemVariants } from '@/components/ui/tabs'
import { useAuth } from '@/hooks/use-auth'
import { useLeagueScoringFamily } from '@/hooks/use-draft-pool'
import { useLeague, type LeagueDetail } from '@/hooks/use-league'
import { useRoomEntryTarget } from '@/hooks/use-room-entry-target'
import { useStandings } from '@/hooks/use-standings'
import { deriveRosterSize } from '@/lib/leagues/settings/league-settings'
import { cn } from '@/lib/utils'
import { useHeaderStore } from '@/stores/header-store'
import { useCommishOverrideStore, useOverrideMode, useOverrideSaving } from '@/stores/commish-override-store'

import { Crest } from './league-cells'
import {
  LEAGUE_STATUS_BADGE,
  OVERRIDE_ON_INDICATOR,
  SCORING_FAMILY_LABEL,
  activeLeagueSection,
  identityLine,
  leagueMoreItems,
  leagueTabs,
  seasonStarted,
  type LeagueMoreItem,
  type LeagueMoreKey,
  type LeagueTab,
  type LeagueTabKey,
} from './league-shell-ops'
import { formatRecord } from './standings-table-ops'

/**
 * THE league header — mounted once by `[leagueId]/layout.tsx` for every
 * league page in every state (League UX batch 1, Chris 2026-10-03; the
 * prototype's `LeagueIdentity` + `LeagueSubnav`).
 *
 * Desktop: it claims the app shell's ONE sticky header (`setLeagueHeader`) —
 * the identity row above, the sub-nav as the main row, and while override
 * mode is on, a slim "Commissioner override on · Turn off" indicator on the
 * right. While it holds the bar, pages' own `PageHeader` titles are not
 * shown, so there is never a second header. Mobile (the shell hides its
 * header below `lg`): the same identity + nav render at the top of the page.
 *
 * Reads only the league detail query the pages already share, the viewer's
 * standings row (record / rank — omitted until the season has results) and
 * the scoring family. Playoff odds are not computed anywhere, so they are
 * not shown.
 */
export function LeagueShell({ leagueId, children }: { leagueId: string; children: ReactNode }) {
  const league = useLeague(leagueId)
  const data = league.data
  return (
    <>
      {data ? <LeagueHeaderClaim leagueId={leagueId} data={data} /> : null}
      {data ? (
        <div className="mb-4 flex flex-col gap-3 border-b border-ink pb-3 lg:hidden" data-league-header-mobile>
          <LeagueHeaderParts leagueId={leagueId} data={data} />
        </div>
      ) : null}
      {children}
    </>
  )
}

function useHeaderParts(leagueId: string, data: LeagueDetail) {
  const pathname = usePathname() ?? ''
  const { user } = useAuth()
  const myTeamId = data.members.find((m) => m.user_id && m.user_id === user?.id)?.team_id ?? null
  const status = data.league.status
  const isCommish = data.my_role === 'commissioner' || data.my_role === 'co_commissioner'
  const tabs = leagueTabs(leagueId, status, myTeamId)
  const more = leagueMoreItems(leagueId, status)
  const active = activeLeagueSection(pathname, leagueId, myTeamId)
  return { myTeamId, status, isCommish, tabs, more, active }
}

/** Puts the identity row + sub-nav into the shell header while mounted. */
function LeagueHeaderClaim({ leagueId, data }: { leagueId: string; data: LeagueDetail }) {
  const setLeagueHeader = useHeaderStore((s) => s.setLeagueHeader)
  const clearLeagueHeader = useHeaderStore((s) => s.clearLeagueHeader)
  const { myTeamId, status, isCommish, tabs, more, active } = useHeaderParts(leagueId, data)
  const identity = useIdentity(leagueId, data, myTeamId)
  const overrideOn = useOverrideMode(leagueId) && isCommish

  // R1462: memo on SCALARS. `identity` / `tabs` / `more` are fresh objects
  // every render, so a memo over them never hit; every one of them is a pure
  // function of the scalars below (`leagueTabs` / `leagueMoreItems` read only
  // leagueId + status + myTeamId), so those are the honest dependencies.
  const { teamName, leagueName, leagueAvatar, line, status: idStatus, record, rank } = identity
  const above = useMemo(
    () => <LeagueIdentity {...{ teamName, leagueName, leagueAvatar, line, status: idStatus, record, rank }} />,
    [teamName, leagueName, leagueAvatar, line, idStatus, record, rank],
  )
  // eslint-disable-next-line react-hooks/exhaustive-deps -- tabs/more derive from leagueId+status+myTeamId (above)
  const nav = useMemo(() => <LeagueSubnav tabs={tabs} more={more} active={active} />, [leagueId, status, myTeamId, active])
  const actions = useMemo(() => (overrideOn ? <OverrideIndicator /> : null), [overrideOn])

  useEffect(() => {
    setLeagueHeader({ above, nav, actions })
  }, [above, nav, actions, setLeagueHeader])
  useEffect(() => () => clearLeagueHeader(), [clearLeagueHeader])
  return null
}

/** The mobile copy (and the render-test surface): identity, indicator, nav. */
export function LeagueHeaderParts({ leagueId, data }: { leagueId: string; data: LeagueDetail }) {
  const { myTeamId, isCommish, tabs, more, active } = useHeaderParts(leagueId, data)
  const identity = useIdentity(leagueId, data, myTeamId)
  const overrideOn = useOverrideMode(leagueId) && isCommish
  return (
    <>
      <LeagueIdentity {...identity} />
      {overrideOn && <OverrideIndicator />}
      <div className="overflow-x-auto">
        <LeagueSubnav tabs={tabs} more={more} active={active} />
      </div>
    </>
  )
}

interface IdentityProps {
  teamName: string | null
  leagueName: string
  leagueAvatar: string | null
  line: string
  status: string
  record: string | null
  rank: number | null
}

function useIdentity(leagueId: string, data: LeagueDetail, myTeamId: string | null): IdentityProps {
  const started = seasonStarted(data.league.status)
  const standings = useStandings(started ? leagueId : undefined)
  const scoring = useLeagueScoringFamily(leagueId)
  const myRow = myTeamId ? standings.data?.standings.find((r) => r.team_id === myTeamId) : undefined
  // A record only once a week has gone final — never an invented 0-0.
  const hasResults = Boolean(myRow && standings.data?.reason !== 'no_final_weeks' && myRow.games > 0)
  const teamName = myTeamId ? (data.teams.find((t) => t.id === myTeamId)?.name ?? null) : null
  const teamCount = data.teams.filter((t) => t.status !== 'retired').length || data.settings.team_count
  return {
    teamName,
    leagueName: data.league.name,
    leagueAvatar: data.league.avatar_url,
    line: identityLine(
      teamCount,
      data.settings.roster_settings ? deriveRosterSize(data.settings.roster_settings) : null,
      scoring.family ? SCORING_FAMILY_LABEL[scoring.family] : null,
    ),
    status: data.league.status,
    record: hasResults && myRow ? formatRecord(myRow) : null,
    rank: hasResults && myRow ? myRow.rank : null,
  }
}

/** Prototype `LeagueIdentity`, at the app's ×0.8 scale: team crest + team
 *  name, then the league line; record / rank chips on the right. */
function LeagueIdentity({ teamName, leagueName, leagueAvatar, line, status, record, rank }: IdentityProps) {
  const statusBadge = LEAGUE_STATUS_BADGE[status] ?? { label: status, variant: 'stroke' as const }
  const title = teamName ?? leagueName
  return (
    <div className="flex min-w-0 flex-1 items-center gap-3" data-league-identity>
      <Crest name={title} src={teamName ? null : leagueAvatar} className="h-10 w-10" fallbackClassName="text-[12px]" />
      <div className="mr-auto min-w-0">
        <div className="truncate text-[17px] font-extrabold leading-tight" data-identity-team>
          {title}
        </div>
        <div className="mt-0.5 flex min-w-0 items-center gap-1.5">
          {teamName && <Crest name={leagueName} src={leagueAvatar} className="h-3.5 w-3.5" fallbackClassName="text-[6px]" />}
          {teamName && <span className="whitespace-nowrap text-[10px] font-extrabold">{leagueName}</span>}
          <span className="truncate text-[10px] font-semibold text-n-3" data-identity-line>
            {line}
          </span>
        </div>
      </div>
      {record !== null ? (
        <Badge variant="green" data-identity-record>
          {record}
        </Badge>
      ) : (
        <Badge variant={statusBadge.variant} data-identity-status>
          {statusBadge.label}
        </Badge>
      )}
      {rank !== null && (
        <Badge variant="stroke" data-identity-rank>
          Rank #{rank}
        </Badge>
      )}
    </div>
  )
}

const navItemClass = segmentItemVariants({ appearance: 'bare', shape: 'label' })

/** Prototype `LeagueSubnav`: six tabs + More. A tab with no meaning in this
 *  league state is shown disabled with its reason — never a dead link. */
function LeagueSubnav({
  tabs,
  more,
  active,
}: {
  tabs: LeagueTab[]
  more: LeagueMoreItem[]
  active: LeagueTabKey | LeagueMoreKey | null
}) {
  const inMore = more.some((m) => m.key === active)
  return (
    <nav className="flex items-center gap-1" aria-label="League pages" data-league-nav>
      {tabs.map((tab) =>
        tab.href ? (
          <Link
            key={tab.key}
            href={tab.href}
            className={navItemClass}
            data-state={active === tab.key ? 'active' : 'inactive'}
            aria-current={active === tab.key ? 'page' : undefined}
            data-nav={tab.key}
          >
            {tab.label}
          </Link>
        ) : (
          <span
            key={tab.key}
            className={cn(navItemClass, 'cursor-not-allowed opacity-40')}
            data-state="inactive"
            aria-disabled="true"
            title={tab.disabledReason ?? undefined}
            data-nav={tab.key}
            data-nav-disabled={tab.disabledReason ?? ''}
          >
            {tab.label}
          </span>
        ),
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={navItemClass}
            data-state={inMore ? 'active' : 'inactive'}
            aria-label="More league pages"
            data-nav="more"
          >
            <Icon name="dots" size={13} />
            More
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          {more.map((item) => (
            <MoreItem key={item.key} item={item} active={active === item.key} />
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </nav>
  )
}

function MoreItem({ item, active }: { item: LeagueMoreItem; active: boolean }) {
  const roomEntry = useRoomEntryTarget()
  return (
    <DropdownMenuItem asChild>
      <Link
        href={item.href}
        aria-current={active ? 'page' : undefined}
        data-more={item.key}
        className={cn(active && 'bg-accent-soft')}
        {...(item.room ? roomEntry : {})}
      >
        {item.label}
      </Link>
    </DropdownMenuItem>
  )
}

/** While override mode is on: a slim reminder with its off switch. It is
 *  turned ON only from League settings / the Commissioner console. */
function OverrideIndicator() {
  const exit = useCommishOverrideStore((s) => s.exit)
  // R1460: the same in-flight lock OverrideModeBar gave its switch — the
  // mode cannot be turned off under a save that is still on the wire.
  const busy = useOverrideSaving()
  return (
    <div className="flex shrink-0 items-center gap-2" role="status" data-override-indicator>
      <Badge variant="black">{OVERRIDE_ON_INDICATOR}</Badge>
      <Button
        variant="stroke"
        size="sm"
        disabled={busy}
        title={busy ? 'Wait for the save to finish.' : undefined}
        onClick={() => {
          if (busy) return
          exit()
        }}
        data-override-off
        data-override-toggle-blocked={busy ? 'saving' : undefined}
      >
        Turn off
      </Button>
    </div>
  )
}
