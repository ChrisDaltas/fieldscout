'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { PageHeader } from '@/components/layout/app-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Icon } from '@/components/ui/icon'
import { cn } from '@/lib/utils'

import { Crest } from './league-cells'
import { LeagueHomeTab } from './league-home-tab'
import { LeagueMatchupTab } from './league-matchup-tab'
import { LeagueMyTeamTab } from './league-my-team-tab'
import { LeaguePlayersTab } from './league-players-tab'
import { LeagueScheduleTab } from './league-schedule-tab'
import { LeagueStatsTab } from './league-stats-tab'
import {
  MOCK_ROSTER_SPOT_COUNT,
  getMockLeague,
  getMockLeagueTeams,
  type MockLeague,
} from './league-mock-data'

/**
 * League workspace — the league-scoped surface (package screens 10/11):
 * identity row (square crest, team + league names, meta, record/rank/playoff
 * chips), boxed sub-nav, then the active tab. League settings lives in the
 * sub-nav as a link to the scoring builder (`/app/settings/scoring`) until
 * league-scoped settings exist.
 *
 * TODO(live-draft): the league backend does not exist — `leagueId` resolves
 * against mock leagues (unknown ids fall back to the demo league). Swap
 * `getMockLeague` for the real league query when leagues land.
 */

const LEAGUE_TABS = [
  { value: 'home', label: 'Home' },
  { value: 'my-team', label: 'My team' },
  { value: 'matchup', label: 'Matchup' },
  { value: 'players', label: 'Players' },
  { value: 'schedule', label: 'Schedule' },
  { value: 'stats', label: 'Stats' },
] as const

export type LeagueWorkspaceTab = (typeof LEAGUE_TABS)[number]['value']

function isLeagueTab(value: string | undefined): value is LeagueWorkspaceTab {
  return LEAGUE_TABS.some((tab) => tab.value === value)
}

/** Crest + team name + league meta line + record/rank/playoff chips. */
function LeagueIdentityRow({ league }: { league: MockLeague }) {
  const teams = getMockLeagueTeams(league.id)
  // "PPR · 12 team" → scoring leads the format string.
  const scoring = league.format.split(' · ')[0]

  return (
    <Card>
      <CardContent className="flex flex-wrap items-center gap-3 px-card-pad py-3">
        <Crest
          name={league.team}
          className="h-10 w-10"
          fallbackClassName="text-[12px]"
        />
        <div className="mr-auto min-w-0">
          <h1 className="truncate text-[17px] font-extrabold leading-tight">
            {league.team}
          </h1>
          <div className="mt-1 flex min-w-0 items-center gap-1.5">
            <Crest
              name={league.name}
              className="h-3.5 w-3.5"
              fallbackClassName="text-[6px]"
            />
            <span className="shrink-0 truncate text-[10px] font-extrabold">
              {league.name}
            </span>
            <span className="truncate text-[10px] font-semibold text-n-3">
              <span className="fs-num">{teams.length}</span> teams ·{' '}
              <span className="fs-num">{MOCK_ROSTER_SPOT_COUNT}</span> roster
              spots · {scoring}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="green">
            <span className="fs-num">{league.record}</span>
          </Badge>
          <Badge variant="stroke">
            Rank <span className="fs-num">#{league.rank}</span>
          </Badge>
          <Badge variant="stroke">
            Playoff odds <span className="fs-num">{league.playoff}%</span>
          </Badge>
        </div>
      </CardContent>
    </Card>
  )
}

interface LeagueWorkspaceProps {
  leagueId: string
  /** Raw `?tab=` value — anything unknown lands on Home. */
  initialTab?: string
}

export function LeagueWorkspace({ leagueId, initialTab }: LeagueWorkspaceProps) {
  const router = useRouter()
  const league = getMockLeague(leagueId)
  const [tab, setTab] = useState<LeagueWorkspaceTab>(
    isLeagueTab(initialTab) ? initialTab : 'home',
  )

  const handleTabChange = (next: LeagueWorkspaceTab) => {
    setTab(next)
    // Keep the tab in the URL so league views are shareable/refreshable.
    router.replace(`/app/leagues/${leagueId}?tab=${next}`, { scroll: false })
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={league.name}
        actions={
          <div className="flex items-center gap-2.5">
            {league.liveDraft && (
              <Button variant="lime" size="sm" shadow asChild>
                <Link href={`/app/leagues/${leagueId}/draft`}>
                  <Icon name="fire" size={13} />
                  Join draft
                </Link>
              </Button>
            )}
            <Button variant="stroke" size="sm" asChild>
              <Link href={`/app/leagues/${leagueId}/manage`}>
                <Icon name="setup" size={13} />
                Manage league
              </Link>
            </Button>
          </div>
        }
        subnav={
          // League sub-nav in the header: an underline tab bar, distinct from
          // the boxed content tabs. Active tab carries an accent underline.
          <nav
            className="-mx-7 flex items-center gap-1 overflow-x-auto border-t border-n-4 px-7 scrollbar-none"
            aria-label="League sections"
          >
            {LEAGUE_TABS.map((item) => {
              const active = tab === item.value
              return (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => handleTabChange(item.value)}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'relative shrink-0 whitespace-nowrap px-3 py-2.5 text-[12px] font-extrabold transition-colors',
                    active ? 'text-ink' : 'text-n-3 hover:text-ink',
                  )}
                >
                  {item.label}
                  {active && (
                    <span className="absolute inset-x-3 bottom-0 h-[2px] bg-accent" />
                  )}
                </button>
              )
            })}
            <Link
              href="/app/settings/scoring"
              className="shrink-0 whitespace-nowrap px-3 py-2.5 text-[12px] font-extrabold text-n-3 transition-colors hover:text-ink"
            >
              League settings
            </Link>
          </nav>
        }
      />

      <LeagueIdentityRow league={league} />

      <div>
        {tab === 'home' && (
          <LeagueHomeTab
            league={league}
            onOpenMatchup={() => handleTabChange('matchup')}
          />
        )}
        {tab === 'my-team' && <LeagueMyTeamTab league={league} />}
        {tab === 'matchup' && <LeagueMatchupTab league={league} />}
        {tab === 'players' && <LeaguePlayersTab />}
        {tab === 'schedule' && <LeagueScheduleTab league={league} />}
        {tab === 'stats' && <LeagueStatsTab league={league} />}
      </div>
    </div>
  )
}
