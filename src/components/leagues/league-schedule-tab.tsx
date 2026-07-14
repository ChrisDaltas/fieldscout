import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'

import { TeamCell } from './league-cells'
import {
  MOCK_CURRENT_WEEK,
  MOCK_SCHEDULE,
  type MockLeague,
} from './league-mock-data'

/**
 * Schedule — the season week-by-week (TeamView Schedule tab): results table
 * with the live week tinted accent, plus a "This week" summary card.
 *
 * TODO(live-draft): replace the mock schedule with the real season once the
 * league backend exists.
 */

export function LeagueScheduleTab({ league }: { league: MockLeague }) {
  return (
    <div className="grid grid-cols-1 items-start gap-[19px] lg:grid-cols-[1.6fr_1fr]">
      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>Season schedule</CardTitle>
          <Badge variant="green">{league.record}</Badge>
        </CardHeader>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12">Week</TableHead>
              <TableHead>Opponent</TableHead>
              <TableHead className="text-right">Result</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {MOCK_SCHEDULE.map((game) => (
              <TableRow
                key={game.week}
                className={cn(game.live && 'bg-accent-soft hover:bg-accent-soft')}
              >
                <TableCell className="fs-num text-[11px] font-extrabold text-n-3">
                  {game.week}
                </TableCell>
                <TableCell>
                  <TeamCell team={game.opp} />
                </TableCell>
                <TableCell className="text-right">
                  {game.live && (
                    <Badge variant="green">
                      Live ·{' '}
                      <span className="fs-num">
                        {league.proj.toFixed(1)}–{league.oppProj.toFixed(1)}
                      </span>
                    </Badge>
                  )}
                  {game.result && (
                    <span
                      className={cn(
                        'fs-num text-[11px] font-extrabold',
                        game.win ? 'text-positive-strong' : 'text-negative-strong',
                      )}
                    >
                      {game.result}
                    </span>
                  )}
                  {game.kickoff && (
                    <span className="text-[11px] font-semibold text-n-3">
                      {game.kickoff}
                    </span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>This week</CardTitle>
          <Badge variant="stroke">
            Week <span className="fs-num">{MOCK_CURRENT_WEEK}</span>
          </Badge>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <TeamCell
            team={league.opp}
            sub={`Week ${MOCK_CURRENT_WEEK} opponent`}
            crestClassName="h-8 w-8"
          />
          <div className="flex items-center justify-between gap-2.5 border-t border-n-4 pt-3 text-[12px] font-bold">
            <span className="text-n-3">Projection</span>
            <span className="fs-num font-extrabold">
              {league.proj.toFixed(1)} – {league.oppProj.toFixed(1)}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2.5 text-[12px] font-bold">
            <span className="text-n-3">Win probability</span>
            <span className="fs-num font-extrabold">{league.winProb}%</span>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
