'use client'

import { useState } from 'react'

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
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'

import { TeamCell } from './league-cells'
import {
  MOCK_H2H,
  MOCK_HISTORY,
  MOCK_STAT_RECORDS,
  type MockLeague,
  type MockSeasonKey,
} from './league-mock-data'

/**
 * Stats — league history (TeamView Stats tab): scoring-record stat cards,
 * best-team-over-time table with a season filter, and your head-to-head
 * ledger against every opponent.
 *
 * TODO(live-draft): replace mock records/history/H2H with real league data.
 */

const SEASONS: Array<{ value: MockSeasonKey; label: string }> = [
  { value: 'all', label: 'All time' },
  { value: '2026', label: '2026' },
  { value: '2025', label: '2025' },
  { value: '2024', label: '2024' },
]

function winPct(w: number, l: number): number {
  return Math.round((w / (w + l)) * 100)
}

export function LeagueStatsTab({ league }: { league: MockLeague }) {
  const [season, setSeason] = useState<MockSeasonKey>('all')
  const rows = MOCK_HISTORY[season]
  const best = rows
    .slice()
    .sort((a, b) => winPct(b.w, b.l) - winPct(a.w, a.l) || b.pf - a.pf)

  return (
    <div className="flex flex-col gap-[19px]">
      <div className="flex flex-wrap items-center gap-2.5">
        <h2 className="mr-auto text-h5">League stats</h2>
        <Tabs
          value={season}
          onValueChange={(value) => setSeason(value as MockSeasonKey)}
        >
          <TabsList>
            {SEASONS.map((s) => (
              <TabsTrigger key={s.value} value={s.value}>
                {s.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      {/* Scoring records — your team's season in four numbers. */}
      <div className="grid grid-cols-2 gap-[13px] lg:grid-cols-4">
        {MOCK_STAT_RECORDS.map((record) => (
          <Card key={record.label}>
            <CardContent className="p-[13px]">
              <div className="truncate text-[10px] font-semibold text-n-3">
                {record.label}
              </div>
              <div className="fs-num mt-1.5 text-[22px] font-extrabold leading-none">
                {record.value}
              </div>
              <div className="mt-1.5 truncate text-[10px] font-semibold text-n-3">
                {record.sub}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 items-start gap-[19px] xl:grid-cols-2">
        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle>Best team over time</CardTitle>
            <Badge variant="stroke">
              {season === 'all' ? 'All seasons' : season}
            </Badge>
          </CardHeader>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <TableHead>Team</TableHead>
                <TableHead className="text-right">W–L</TableHead>
                <TableHead className="text-right">Win %</TableHead>
                <TableHead className="text-right">PF</TableHead>
                <TableHead className="text-right">Titles</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {best.map((team, i) => (
                <TableRow
                  key={team.team}
                  className={cn(
                    team.team === league.team &&
                      'bg-accent-soft hover:bg-accent-soft',
                  )}
                >
                  <TableCell className="fs-num text-[11px] font-extrabold text-n-3">
                    {i + 1}
                  </TableCell>
                  <TableCell>
                    <TeamCell team={team.team} />
                  </TableCell>
                  <TableCell className="fs-num text-right text-[11px] font-extrabold">
                    {team.w}–{team.l}
                  </TableCell>
                  <TableCell className="fs-num text-right text-[11px] font-bold">
                    {winPct(team.w, team.l)}%
                  </TableCell>
                  <TableCell className="fs-num text-right text-[11px] font-bold text-n-3">
                    {team.pf.toLocaleString()}
                  </TableCell>
                  <TableCell className="fs-num text-right text-[11px] font-extrabold">
                    {team.titles || '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>

        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle>Head to head</CardTitle>
            <Badge variant="stroke">{league.team}</Badge>
          </CardHeader>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Opponent</TableHead>
                <TableHead className="text-right">Record</TableHead>
                <TableHead className="text-right">PF · PA</TableHead>
                <TableHead className="text-right">Last meeting</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {MOCK_H2H.map((matchup) => (
                <TableRow key={matchup.team}>
                  <TableCell>
                    <TeamCell team={matchup.team} />
                  </TableCell>
                  <TableCell
                    className={cn(
                      'fs-num text-right text-[11px] font-extrabold',
                      matchup.w >= matchup.l
                        ? 'text-positive-strong'
                        : 'text-negative-strong',
                    )}
                  >
                    {matchup.w}–{matchup.l}
                  </TableCell>
                  <TableCell className="fs-num text-right text-[10px] font-bold text-n-3">
                    {matchup.pf.toFixed(1)} · {matchup.pa.toFixed(1)}
                  </TableCell>
                  <TableCell className="fs-num text-right text-[10px] font-bold">
                    {matchup.last}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      </div>
    </div>
  )
}
