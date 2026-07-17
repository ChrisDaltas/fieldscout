import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'

import { Crest, PlayerCell, WinProbMeter } from './league-cells'
import {
  MOCK_DISPLAY_WEEK,
  MOCK_LINEUP,
  MOCK_OPP_STARTERS,
  type MockLeague,
} from './league-mock-data'

/**
 * Matchup — week head-to-head: your lineup vs the opponent's, slot-aligned,
 * projected totals up top, win-probability meter with an even-odds tick.
 *
 * TODO(live-draft): replace mock rosters/projections with real matchup data.
 */

interface SideProps {
  team: string
  manager: string
  proj: number
  mirror?: boolean
}

function MatchupHeaderSide({ team, manager, proj, mirror }: SideProps) {
  return (
    <div
      className={cn(
        'flex min-w-0 items-center gap-2.5',
        mirror && 'flex-row-reverse',
      )}
    >
      <Crest name={team} className="h-10 w-10" fallbackClassName="text-[11px]" />
      <div className={cn('min-w-0 flex-1', mirror && 'text-right')}>
        <div className="truncate text-[13px] font-extrabold leading-tight">
          {team}
        </div>
        <div className="truncate text-[10px] font-semibold text-n-3">
          {manager}
        </div>
      </div>
      <span className="fs-num text-[27px] font-extrabold leading-none">
        {proj.toFixed(1)}
      </span>
    </div>
  )
}

export function LeagueMatchupTab({ league }: { league: MockLeague }) {
  const winning = league.winProb >= 50

  return (
    <Card>
      <CardContent>
        {/* Header — both teams + projected totals */}
        <div className="grid grid-cols-1 items-center gap-4 border-b border-ink pb-4 sm:grid-cols-[1fr_auto_1fr]">
          <MatchupHeaderSide team={league.team} manager="You" proj={league.proj} />
          <div className="hidden text-center sm:block">
            <div className="fs-overline text-[9px] text-n-3">
              Week <span className="fs-num">{MOCK_DISPLAY_WEEK}</span> · projected
            </div>
            <div className="mt-1 text-[10px] font-extrabold text-n-3">vs</div>
          </div>
          <MatchupHeaderSide
            team={league.opp}
            manager="Rival GM"
            proj={league.oppProj}
            mirror
          />
        </div>

        {/* Win probability — your share fills from the left; the dashed tick
            marks even odds, so whichever side crosses it is visibly favored. */}
        <div className="border-b border-ink py-3">
          <div className="mb-1.5 flex items-baseline justify-between gap-2.5">
            <span
              className={cn(
                'fs-num text-[11px]',
                winning ? 'font-extrabold text-accent-strong' : 'font-bold text-n-3',
              )}
            >
              {league.winProb}%
            </span>
            <span className="fs-overline text-[9px] text-n-3">
              Win probability
            </span>
            <span
              className={cn(
                'fs-num text-[11px]',
                !winning ? 'font-extrabold text-accent-strong' : 'font-bold text-n-3',
              )}
            >
              {100 - league.winProb}%
            </span>
          </div>
          <WinProbMeter value={league.winProb} showTick className="h-3" />
        </div>

        {/* Slot-aligned starters */}
        <div className="fs-overline pb-1.5 pt-3 text-center text-[9px] text-n-3">
          Starters
        </div>
        {MOCK_LINEUP.starters.map((you, i) => {
          const opp = MOCK_OPP_STARTERS[i]
          return (
            <div
              key={you.slot + you.name}
              className="grid grid-cols-[1fr_44px_1fr] items-center gap-2.5 border-b border-n-4 py-2 last:border-0"
            >
              <PlayerCell player={you} meta={`${you.team} · ${you.opp}`} />
              <span className="fs-num text-center text-[10px] font-extrabold text-n-3">
                {you.slot}
              </span>
              <PlayerCell player={opp} meta={`${opp.team} · ${opp.opp}`} mirror />
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}
