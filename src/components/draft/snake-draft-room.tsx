'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'

import type { BuilderPlayer } from '@/components/lists/builder/types'
import { BestAvailableCard } from '@/components/draft/best-available-card'
import { DraftPick } from '@/components/draft/draft-pick'
import { DraftQueueCard } from '@/components/draft/draft-queue-card'
import {
  abbreviateName,
  managerForPick,
  roundForPick,
  type MockLeague,
  type SnakeBoardPick,
  type SnakeDraftState,
} from '@/components/draft/mock-draft'
import {
  formatClock,
  useMockDraftClock,
} from '@/components/draft/use-mock-draft-clock'
import { PageHeader } from '@/components/layout/app-header'
import { AIInsight } from '@/components/ui/ai-insight'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'

const BOARD_COLS = 5
const MIN_SLOTS = 15

interface SnakeDraftRoomProps {
  leagueId: string
  league: MockLeague
  initial: SnakeDraftState
}

/**
 * Snake draft room — live board left (head row with the pick clock, 5-col
 * DraftPick grid, Scout AI suggestion), sticky pick panel right (best
 * available over real player data + your queue).
 *
 * TODO(live-draft): the whole room runs on local simulation state. Drafting
 * fills the on-the-clock cell for whichever manager owns the pick and
 * advances the clock — no server round-trip exists yet.
 */
export function SnakeDraftRoom({
  leagueId,
  league,
  initial,
}: SnakeDraftRoomProps) {
  const [board, setBoard] = useState<SnakeBoardPick[]>(initial.board)
  const [currentPick, setCurrentPick] = useState(initial.currentPick)
  const [queue, setQueue] = useState<BuilderPlayer[]>([])
  const { seconds, reset } = useMockDraftClock(initial.pickClockSeconds)

  const round = roundForPick(currentPick, league.teamCount)
  const draftedNames = useMemo(
    () => new Set(board.map((b) => b.playerName)),
    [board],
  )
  const queuedIds = useMemo(() => new Set(queue.map((p) => p.id)), [queue])

  const picksByNumber = useMemo(
    () => new Map(board.map((b) => [b.pick, b])),
    [board],
  )

  // Show at least 3 rows; grow row by row as the sim drafts past them.
  const slotCount = Math.min(
    Math.max(MIN_SLOTS, Math.ceil((currentPick + 2) / BOARD_COLS) * BOARD_COLS),
    league.teamCount * league.rounds,
  )

  // TODO(live-draft): submit the pick to the draft service. Locally the pick
  // goes to whichever manager is on the clock and the board advances.
  const handleDraft = (player: BuilderPlayer) => {
    setBoard((cur) => [
      ...cur,
      {
        pick: currentPick,
        playerName: player.full_name,
        position: player.position,
        team: player.team ?? '—',
        byManager: managerForPick(currentPick, initial.managers),
      },
    ])
    setCurrentPick((p) => p + 1)
    setQueue((cur) => cur.filter((q) => q.id !== player.id))
    reset()
  }

  const handleQueue = (player: BuilderPlayer) => {
    setQueue((cur) =>
      cur.some((q) => q.id === player.id) ? cur : [...cur, player],
    )
  }

  const handleUnqueue = (playerId: string) => {
    setQueue((cur) => cur.filter((q) => q.id !== playerId))
  }

  return (
    <>
      <PageHeader
        title="Snake draft"
        actions={
          <Button variant="ghost" size="sm" asChild>
            <Link href={`/app/leagues/${leagueId}`}>Exit room</Link>
          </Button>
        }
      />

      <div className="grid items-start gap-5 lg:grid-cols-[1.5fr_1fr]">
        {/* Board */}
        <div className="flex min-w-0 flex-col gap-5">
          <Card>
            <CardHeader>
              <div className="flex min-w-0 items-center gap-2.5">
                <Badge variant="green" className="shrink-0">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-pill bg-current" />
                  Live
                </Badge>
                <span className="truncate text-[13px] font-extrabold">
                  Round <span className="fs-num">{round}</span> · Pick{' '}
                  <span className="fs-num">{currentPick}</span>
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="fs-overline text-n-3">On the clock</span>
                <span className="fs-num text-[18px] font-extrabold text-accent-strong">
                  {formatClock(seconds)}
                </span>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-5">
                {Array.from({ length: slotCount }, (_, i) => {
                  const pickNumber = i + 1
                  const pick = picksByNumber.get(pickNumber)
                  return pick ? (
                    <DraftPick
                      key={pickNumber}
                      pick={pick.pick}
                      playerName={abbreviateName(pick.playerName)}
                      position={pick.position}
                      team={pick.team}
                      byManager={pick.byManager}
                    />
                  ) : (
                    <DraftPick
                      key={pickNumber}
                      pick={pickNumber}
                      empty
                      onClock={pickNumber === currentPick}
                    />
                  )
                })}
              </div>
            </CardContent>
          </Card>

          <AIInsight heading={initial.aiSuggestion.heading} confidence="high">
            {initial.aiSuggestion.body}
          </AIInsight>
        </div>

        {/* Pick panel */}
        <div className="flex min-w-0 flex-col gap-5 lg:sticky lg:top-5">
          <BestAvailableCard
            draftedNames={draftedNames}
            queuedIds={queuedIds}
            onDraft={handleDraft}
            onQueue={handleQueue}
          />
          <DraftQueueCard queue={queue} onRemove={handleUnqueue} />
        </div>
      </div>
    </>
  )
}
