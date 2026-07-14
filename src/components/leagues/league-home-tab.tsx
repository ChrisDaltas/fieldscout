'use client'

import { useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Icon } from '@/components/ui/icon'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { UserAvatar } from '@/components/ui/user-avatar'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'

import { Crest, TeamCell, WinProbMeter } from './league-cells'
import {
  MOCK_CURRENT_WEEK,
  MOCK_MATCHUPS,
  MOCK_MESSAGES,
  MOCK_SCHEDULE,
  getMockStandings,
  type MockLeague,
  type MockMatchup,
  type MockMatchupSide,
} from './league-mock-data'

/**
 * League home — the league pulse (package screen 11): live scoreboard beside
 * standings, schedule strip + message board below. Mock data throughout.
 *
 * TODO(live-draft): replace mock matchups/standings/board with real data.
 */

// TODO(live-draft): stub — box scores need real matchup data.
function boxScoreStub() {
  toast({
    title: 'Box scores are coming',
    description: 'Play-by-play scoring lands with league sync.',
  })
}

function MatchupSide({ side, winning }: { side: MockMatchupSide; winning: boolean }) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2.5">
      <Crest name={side.team} className="h-8 w-8" fallbackClassName="text-[10px]" />
      <div className="min-w-0">
        <div className="truncate text-[11px] font-extrabold leading-tight">
          {side.team}
        </div>
        <div className="truncate text-[10px] font-semibold text-n-3">
          {side.manager} · <span className="fs-num">{side.yetToPlay}</span> yet
          to play
        </div>
      </div>
      <span
        className={cn(
          'fs-num ml-auto text-[21px] font-extrabold leading-none',
          winning ? 'text-ink' : 'text-n-3',
        )}
      >
        {side.proj.toFixed(1)}
      </span>
    </div>
  )
}

function MatchupCard({
  matchup,
  onOpenMatchup,
}: {
  matchup: MockMatchup
  onOpenMatchup: () => void
}) {
  const homeWinning = matchup.winProb >= 50
  return (
    <Card className="shadow-hard-4">
      <CardContent>
        <div className="flex items-center gap-4">
          <MatchupSide side={matchup.home} winning={homeWinning} />
          <span className="shrink-0 text-[10px] font-extrabold text-n-3">vs</span>
          <MatchupSide side={matchup.away} winning={!homeWinning} />
        </div>
        <div className="mt-3 flex items-center gap-2.5">
          <span
            className={cn(
              'fs-num w-8 text-[10px] font-extrabold',
              homeWinning ? 'text-accent-strong' : 'text-n-3',
            )}
          >
            {matchup.winProb}%
          </span>
          <WinProbMeter value={matchup.winProb} className="flex-1" />
          <span
            className={cn(
              'fs-num w-8 text-right text-[10px] font-extrabold',
              !homeWinning ? 'text-accent-strong' : 'text-n-3',
            )}
          >
            {100 - matchup.winProb}%
          </span>
        </div>
        <div className="mt-3 flex gap-2">
          <Button variant="stroke" size="sm" onClick={onOpenMatchup}>
            <Icon name="chart" />
            Matchup
          </Button>
          <Button variant="ghost" size="sm" onClick={boxScoreStub}>
            <Icon name="table" />
            Box score
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function Scoreboard({ onOpenMatchup }: { onOpenMatchup: () => void }) {
  const [week, setWeek] = useState('w11')
  return (
    <section>
      <div className="mb-2.5 flex items-center gap-2.5">
        <h2 className="mr-auto text-h5">Live scoreboard</h2>
        <Badge variant="green">
          <span className="h-[6px] w-[6px] animate-pulse rounded-full bg-current" />
          Live
        </Badge>
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-2.5">
        {/* TODO(live-draft): weeks beyond the current one need real matchup data. */}
        <Tabs value={week} onValueChange={setWeek}>
          <TabsList>
            <TabsTrigger value="w11">Week 11</TabsTrigger>
            <TabsTrigger value="w12">Week 12</TabsTrigger>
            <TabsTrigger value="po">Playoffs</TabsTrigger>
          </TabsList>
        </Tabs>
        <span className="ml-auto whitespace-nowrap text-[10px] font-semibold text-n-3">
          Updates live · no refresh needed
        </span>
      </div>
      {week === 'w11' ? (
        <div className="flex flex-col gap-4">
          {MOCK_MATCHUPS.map((matchup) => (
            <MatchupCard
              key={`${matchup.home.team}-${matchup.away.team}`}
              matchup={matchup}
              onOpenMatchup={onOpenMatchup}
            />
          ))}
        </div>
      ) : (
        <Card>
          <CardContent>
            <h3 className="text-h6">
              {week === 'po' ? 'Playoffs are not set' : 'Matchups lock later'}
            </h3>
            <p className="mt-1 text-[12px] font-medium text-n-3">
              {week === 'po'
                ? 'Seeds settle after week 14 — check the standings to see who is in the hunt.'
                : 'Next week’s matchups open once this week’s games go final.'}
            </p>
          </CardContent>
        </Card>
      )}
    </section>
  )
}

function StandingsCard({ league }: { league: MockLeague }) {
  const standings = getMockStandings(league.id)
  return (
    <Card>
      <CardHeader>
        <CardTitle>Standings</CardTitle>
        <Badge variant="stroke">Week {MOCK_CURRENT_WEEK}</Badge>
      </CardHeader>
      <div>
        {standings.map((row, i) => (
          <div
            key={row.team}
            className={cn(
              'flex items-center gap-2.5 px-card-pad py-2',
              i < standings.length - 1 && 'border-b border-n-4',
              // Playoff places tint positive; your row reads accent.
              row.manager === 'You'
                ? 'bg-accent-soft'
                : row.rank <= 4 && 'bg-positive-soft',
            )}
          >
            <span className="fs-num w-4 shrink-0 text-[11px] font-extrabold text-n-3">
              {row.rank}
            </span>
            <TeamCell team={row.team} sub={row.manager} className="mr-auto" />
            <span className="fs-num shrink-0 text-[11px] font-extrabold">
              {row.w}–{row.l}
            </span>
            <span className="fs-num w-10 shrink-0 text-right text-[10px] font-bold text-n-3">
              {row.pf.toLocaleString()}
            </span>
          </div>
        ))}
      </div>
    </Card>
  )
}

function ScheduleStrip({ league }: { league: MockLeague }) {
  return (
    // overflow-hidden lets the grid track shrink so the week strip scrolls
    // internally instead of blowing out the page width (matches the sibling
    // schedule/manage tabs).
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle>Schedule</CardTitle>
        <Badge variant="green">{league.record}</Badge>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <div className="flex w-max gap-2">
          {MOCK_SCHEDULE.map((game) => (
            <div
              key={game.week}
              className={cn(
                'w-[104px] shrink-0 rounded-sm border px-2.5 py-2',
                game.live ? 'border-ink bg-accent-soft' : 'border-n-4',
              )}
            >
              <div className="fs-overline text-[9px] text-n-3">
                Week <span className="fs-num">{game.week}</span>
              </div>
              <div className="mt-1.5 flex items-center gap-1.5">
                <Crest name={game.opp} className="h-4 w-4" fallbackClassName="text-[7px]" />
                <span className="truncate text-[10px] font-extrabold">
                  {game.opp}
                </span>
              </div>
              <div className="mt-1.5">
                {game.live && (
                  <Badge variant="green" className="h-[15px] px-1.5 text-[9px]">
                    Live ·{' '}
                    <span className="fs-num">
                      {league.proj.toFixed(1)}–{league.oppProj.toFixed(1)}
                    </span>
                  </Badge>
                )}
                {game.result && (
                  <span
                    className={cn(
                      'fs-num text-[10px] font-extrabold',
                      game.win ? 'text-positive-strong' : 'text-negative-strong',
                    )}
                  >
                    {game.result}
                  </span>
                )}
                {game.kickoff && (
                  <span className="text-[10px] font-semibold text-n-3">
                    {game.kickoff}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

function MessageBoardCard() {
  const [draft, setDraft] = useState('')
  return (
    <Card>
      <CardHeader>
        <CardTitle>Message board</CardTitle>
        <Badge variant="stroke">
          <span className="fs-num">{MOCK_MESSAGES.length}</span> today
        </Badge>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {MOCK_MESSAGES.map((message) => (
          <div key={`${message.user}-${message.time}`} className="flex items-start gap-2">
            <UserAvatar name={message.user} className="h-6 w-6" fallbackClassName="text-[8px]" />
            <div className="min-w-0">
              <div className="text-[10px] font-extrabold">
                {message.user}{' '}
                <span className="fs-num ml-1 font-bold text-n-3">
                  {message.time}
                </span>
              </div>
              <div className="mt-0.5 text-[11px] font-semibold leading-snug">
                {message.text}
              </div>
            </div>
          </div>
        ))}
        <form
          className="flex gap-2 border-t border-n-4 pt-3"
          onSubmit={(event) => {
            event.preventDefault()
            // TODO(live-draft): stub — posting needs the league backend.
            toast({
              title: 'The board opens with league sync',
              description: 'Messages will post to your real league mates soon.',
            })
            setDraft('')
          }}
        >
          <Input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Message the league…"
            className="h-btn-md flex-1 px-2.5 text-[11px]"
          />
          <Button type="submit" variant="blue" size="icon-md" aria-label="Post">
            <Icon name="send" />
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}

interface LeagueHomeTabProps {
  league: MockLeague
  /** Jumps the workspace to the Matchup tab. */
  onOpenMatchup: () => void
}

export function LeagueHomeTab({ league, onOpenMatchup }: LeagueHomeTabProps) {
  return (
    <div className="flex flex-col gap-[19px]">
      <div className="grid grid-cols-1 items-start gap-[19px] lg:grid-cols-[1.6fr_1fr]">
        <Scoreboard onOpenMatchup={onOpenMatchup} />
        <StandingsCard league={league} />
      </div>
      <div className="grid grid-cols-1 items-start gap-[19px] lg:grid-cols-[1.6fr_1fr]">
        <ScheduleStrip league={league} />
        <MessageBoardCard />
      </div>
    </div>
  )
}
