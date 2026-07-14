'use client'

import { useState } from 'react'

import { AIInsight } from '@/components/ui/ai-insight'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle } from '@/components/ui/card'
import { Icon } from '@/components/ui/icon'
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'

import { OprkChip, PlayerCell, StatusTag } from './league-cells'
import {
  MOCK_CURRENT_WEEK,
  MOCK_LINEUP,
  initialsOf,
  type MockLeague,
  type MockLineupPlayer,
} from './league-mock-data'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'

/**
 * My team — set-lineup roster management (package screen 10): collapsible
 * lineup-check ribbon, starters table, bench + IR/DL column right. Rows are
 * static for now — drag wiring is a phase-5 interaction.
 *
 * TODO(live-draft): replace the mock lineup with the real roster and wire
 * Move/slot swaps to the league backend.
 */

// League rule surfaced in the reserve rows (mirrors the prototype).
const DL_MIN_WEEKS = 3

// TODO(live-draft): stub — lineup moves need the league backend.
function moveStub(playerName: string) {
  toast({
    title: `${playerName} stays put for now`,
    description: 'Lineup moves ship with league sync.',
  })
}

interface LineupCheck {
  key: string
  value: string
  ok: boolean
  note: string
}

function buildChecks(league: MockLeague): { checks: LineupCheck[]; total: number } {
  const { starters } = MOCK_LINEUP
  const flagged = starters.filter((p) => p.status)
  const total = starters.reduce((sum, p) => sum + p.proj, 0)
  const diff = total - league.oppProj
  const checks: LineupCheck[] = [
    {
      key: 'Starters set',
      value: `${starters.length} / ${starters.length}`,
      ok: true,
      note: 'Every slot is filled ahead of Sunday’s locks.',
    },
    {
      key: 'Injury risk',
      value: flagged.length === 0 ? 'None' : `${flagged.length} flagged`,
      ok: flagged.length === 0,
      note:
        flagged.length > 0
          ? `${flagged.map((p) => `${p.name} (${p.status})`).join(', ')} — check Sunday inactives before lock.`
          : 'No injury designations in your lineup.',
    },
    {
      key: 'Players on bye',
      value: 'None',
      ok: true,
      note: `No week ${MOCK_CURRENT_WEEK} byes on your roster.`,
    },
    {
      key: 'Proj vs opponent',
      value: `${diff >= 0 ? '+' : ''}${diff.toFixed(1)}`,
      ok: diff >= 0,
      note: `${total.toFixed(1)} vs ${league.opp}’s ${league.oppProj.toFixed(1)} projected.`,
    },
  ]
  return { checks, total }
}

function CheckDot({ ok }: { ok: boolean }) {
  return (
    <span
      className={cn(
        'h-2 w-2 shrink-0 rounded-full border border-ink',
        ok ? 'bg-positive' : 'bg-caution',
      )}
    />
  )
}

function CheckChip({ check }: { check: LineupCheck }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-sm border border-ink bg-white px-2.5 py-1 text-[10px] font-extrabold">
      <CheckDot ok={check.ok} />
      {check.key}
      <span className="fs-num font-bold text-n-3">{check.value}</span>
    </span>
  )
}

/** Collapsible full-width ribbon (Rankings-submissions pattern). */
function LineupCheckRibbon({ checks }: { checks: LineupCheck[] }) {
  const [open, setOpen] = useState(false)
  return (
    <Card className="overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={cn(
          'flex w-full items-center gap-2.5 px-card-pad py-2.5 text-left transition-colors hover:bg-n-4/50',
          open && 'border-b border-ink',
        )}
      >
        <Icon
          name="arrow-bottom"
          size={13}
          className={cn('shrink-0 transition-transform', !open && '-rotate-90')}
        />
        <span className="whitespace-nowrap text-[13px] font-extrabold">
          Lineup check
        </span>
        {!open && (
          <span className="ml-auto hidden flex-wrap items-center justify-end gap-1.5 md:flex">
            {checks.map((check) => (
              <CheckChip key={check.key} check={check} />
            ))}
          </span>
        )}
      </button>
      {open && (
        <div className="grid grid-cols-1 gap-2.5 p-card-pad sm:grid-cols-2">
          {checks.map((check) => (
            <div
              key={check.key}
              className="rounded-sm border border-n-4 px-3 py-2.5"
            >
              <div className="flex items-center gap-2">
                <CheckDot ok={check.ok} />
                <span className="text-[11px] font-extrabold">{check.key}</span>
                <span className="fs-num ml-auto text-[11px] font-extrabold">
                  {check.value}
                </span>
              </div>
              <p className="mt-1 text-[10px] font-semibold leading-relaxed text-n-3">
                {check.note}
              </p>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

function StartersCard({ total }: { total: number }) {
  const [week, setWeek] = useState('w11')
  return (
    <Card>
      <div className="flex items-center gap-2.5 border-b border-ink px-card-pad py-2.5">
        {/* TODO(live-draft): future weeks show this week's mock lineup until
            real schedules exist. */}
        <Tabs value={week} onValueChange={setWeek}>
          <TabsList>
            <TabsTrigger value="w11">Week 11</TabsTrigger>
            <TabsTrigger value="w12">Week 12</TabsTrigger>
            <TabsTrigger value="w13">Week 13</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-11">Slot</TableHead>
            <TableHead>Player</TableHead>
            <TableHead>Opp</TableHead>
            <TableHead className="text-center">OPRK</TableHead>
            <TableHead className="text-right">Proj</TableHead>
            <TableHead className="w-[70px]" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {MOCK_LINEUP.starters.map((player) => (
            <TableRow key={player.slot + player.name}>
              <TableCell className="text-[10px] font-extrabold text-n-3">
                {player.slot}
              </TableCell>
              <TableCell>
                <PlayerCell player={player} />
              </TableCell>
              <TableCell>
                <span className="block text-[10px] font-semibold leading-tight text-n-3">
                  {player.opp}
                </span>
                <span className="block text-[9px] font-semibold leading-tight text-n-3">
                  {player.time}
                </span>
              </TableCell>
              <TableCell className="text-center">
                <OprkChip value={player.oprk} />
              </TableCell>
              <TableCell className="fs-num text-right text-[12px] font-extrabold">
                {player.proj.toFixed(1)}
              </TableCell>
              <TableCell className="text-right">
                <Button
                  variant="stroke"
                  size="sm"
                  onClick={() => moveStub(player.name)}
                >
                  Move
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
        <TableFooter>
          <TableRow className="bg-n-4/50 hover:bg-n-4/50">
            <TableCell colSpan={4} className="py-2.5 text-[10px] font-extrabold text-n-3">
              Projected total
            </TableCell>
            <TableCell className="fs-num py-2.5 text-right text-[14px] font-extrabold">
              {total.toFixed(1)}
            </TableCell>
            <TableCell />
          </TableRow>
        </TableFooter>
      </Table>
    </Card>
  )
}

function BenchRow({ player }: { player: MockLineupPlayer }) {
  return (
    <div className="flex items-center gap-2 border-b border-n-4 px-card-pad py-2">
      <Avatar className="h-6 w-6 shrink-0">
        <AvatarFallback className="text-[8px]">
          {initialsOf(player.name)}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[11px] font-extrabold leading-tight">
          {player.name}
          <StatusTag status={player.status} />
        </div>
        <div className="mt-0.5 flex items-center gap-1.5">
          <span className="truncate text-[10px] font-semibold text-n-3">
            {player.team} · {player.opp}
          </span>
        </div>
      </div>
      <span className="fs-num shrink-0 text-[11px] font-extrabold">
        {player.proj.toFixed(1)}
      </span>
      <Button variant="stroke" size="sm" onClick={() => moveStub(player.name)}>
        Move
      </Button>
    </div>
  )
}

function BenchCard() {
  const reserveRows = [
    { code: 'IR', player: MOCK_LINEUP.ir, note: 'Empty — for players ruled out' },
    {
      code: 'DL',
      player: MOCK_LINEUP.dl,
      note: `Empty — out players · stays ${DL_MIN_WEEKS}+ weeks (league rule)`,
    },
  ]
  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle>Bench</CardTitle>
      </CardHeader>
      <div>
        {MOCK_LINEUP.bench.map((player) => (
          <BenchRow key={player.name} player={player} />
        ))}
        <div className="fs-overline border-b border-n-4 bg-page px-card-pad py-2 text-[9px] text-n-3">
          Reserve
        </div>
        {reserveRows.map((row, i) => (
          <div
            key={row.code}
            className={cn(
              'flex items-center gap-2.5 bg-page px-card-pad py-2.5',
              i === 0 && 'border-b border-n-4',
            )}
          >
            <Badge variant="black" className="min-w-[28px] shrink-0 justify-center">
              {row.code}
            </Badge>
            {row.player ? (
              <>
                <span className="min-w-0 flex-1 truncate text-[11px] font-extrabold">
                  {row.player.name}
                  <StatusTag status={row.player.status} />
                </span>
                <Button
                  variant="stroke"
                  size="sm"
                  onClick={() => moveStub(row.player!.name)}
                >
                  Move
                </Button>
              </>
            ) : (
              <span className="text-[10px] font-semibold text-n-3">
                {row.note}
              </span>
            )}
          </div>
        ))}
      </div>
    </Card>
  )
}

export function LeagueMyTeamTab({ league }: { league: MockLeague }) {
  const { checks, total } = buildChecks(league)

  return (
    <div className="flex flex-col gap-[19px]">
      <LineupCheckRibbon checks={checks} />

      <div className="grid grid-cols-1 items-start gap-[19px] lg:grid-cols-[1.7fr_1fr]">
        <StartersCard total={total} />

        <div className="flex flex-col gap-[19px]">
          <BenchCard />
          {/* Start/sit call — AI moments are always ultramarine. */}
          <AIInsight heading="Swap Wilson → Evans" confidence="high">
            Wilson (Q, hamstring) draws SF’s #5 pass defense. Evans is healthy
            with a #25 matchup at Atlanta — a +4.1 projection swing.
          </AIInsight>
        </div>
      </div>
    </div>
  )
}
