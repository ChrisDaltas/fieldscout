'use client'

import { useState } from 'react'

import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { FilterChip } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Icon } from '@/components/ui/icon'
import { PositionBadge } from '@/components/players/position-badge'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'

import { PlayerCell } from './league-cells'
import {
  MOCK_FREE_AGENTS,
  MOCK_LINEUP,
  initialsOf,
  type MockFreeAgent,
  type MockLineupPlayer,
} from './league-mock-data'

/**
 * Players — the league player pool (TeamView Players tab): free agents ⇄ on
 * roster toggle. Free agents sort by add %, roster shows starters first.
 *
 * TODO(live-draft): replace the mock pool with real league availability and
 * wire Add / Move / Drop to the league backend (player exclusivity — a player
 * on any roster in this league never shows as a free agent).
 */

type Pool = 'fa' | 'roster'

// TODO(live-draft): stubs — roster moves need the league backend.
function addStub(name: string) {
  toast({
    title: `${name} stays on waivers for now`,
    description: 'Adds and FAAB bids ship with league sync.',
  })
}

function moveStub(name: string) {
  toast({
    title: `${name} stays put for now`,
    description: 'Lineup moves ship with league sync.',
  })
}

function dropStub(name: string) {
  toast({
    title: `${name} is safe`,
    description: 'Drops ship with league sync.',
  })
}

function FreeAgentRow({ agent, isLast }: { agent: MockFreeAgent; isLast: boolean }) {
  return (
    <div
      className={cn(
        'flex items-center gap-2.5 px-card-pad py-2',
        !isLast && 'border-b border-n-4',
      )}
    >
      <Avatar className="h-7 w-7 shrink-0">
        <AvatarFallback className="text-[9px]">
          {initialsOf(agent.name)}
        </AvatarFallback>
      </Avatar>
      <div className="mr-auto min-w-0">
        <div className="truncate text-[11px] font-extrabold leading-tight">
          {agent.name}
        </div>
        <div className="mt-0.5 flex items-center gap-1.5">
          <PositionBadge position={agent.pos} size="sm" className="shrink-0" />
          <span className="truncate text-[10px] font-semibold text-n-3">
            {agent.team} · <span className="fs-num">{agent.rostered}%</span>{' '}
            rostered
          </span>
        </div>
      </div>
      <span className="fs-num shrink-0 text-[10px] font-extrabold text-positive-strong">
        +{agent.add}%
      </span>
      <span className="fs-num hidden w-14 shrink-0 text-right text-[10px] font-bold text-n-3 sm:block">
        {agent.faab} FAAB
      </span>
      <Button variant="green" size="sm" onClick={() => addStub(agent.name)}>
        <Icon name="plus" />
        Add
      </Button>
    </div>
  )
}

function RosterRow({ player, isLast }: { player: MockLineupPlayer; isLast: boolean }) {
  return (
    <div
      className={cn(
        'flex items-center gap-2.5 px-card-pad py-2',
        !isLast && 'border-b border-n-4',
        player.slot === 'BE' && 'bg-page',
      )}
    >
      <span className="w-8 shrink-0 text-[10px] font-extrabold text-n-3">
        {player.slot}
      </span>
      <PlayerCell
        player={player}
        meta={`${player.team} · ${player.opp} ${player.time}`}
        className="mr-auto"
      />
      <span className="fs-num w-10 shrink-0 text-right text-[11px] font-extrabold">
        {player.proj.toFixed(1)}
      </span>
      <Button variant="stroke" size="sm" onClick={() => moveStub(player.name)}>
        <Icon name="transfer" />
        Move
      </Button>
      <Button variant="ghost" size="sm" onClick={() => dropStub(player.name)}>
        Drop
      </Button>
    </div>
  )
}

export function LeaguePlayersTab() {
  const [pool, setPool] = useState<Pool>('fa')
  // Starters first, then bench (the prototype's "Starters first" order).
  const roster = [...MOCK_LINEUP.starters, ...MOCK_LINEUP.bench]

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-ink px-card-pad py-2.5">
        <FilterChip pressed={pool === 'fa'} onPressedChange={() => setPool('fa')}>
          Free agents
        </FilterChip>
        <FilterChip
          pressed={pool === 'roster'}
          onPressedChange={() => setPool('roster')}
        >
          On roster
        </FilterChip>
        <span className="ml-auto whitespace-nowrap text-[10px] font-semibold text-n-3">
          {pool === 'fa' ? 'Sorted by add %' : 'Starters first'}
        </span>
      </div>
      <div>
        {pool === 'fa'
          ? MOCK_FREE_AGENTS.map((agent, i) => (
              <FreeAgentRow
                key={agent.name}
                agent={agent}
                isLast={i === MOCK_FREE_AGENTS.length - 1}
              />
            ))
          : roster.map((player, i) => (
              <RosterRow
                key={player.name}
                player={player}
                isLast={i === roster.length - 1}
              />
            ))}
      </div>
    </Card>
  )
}
