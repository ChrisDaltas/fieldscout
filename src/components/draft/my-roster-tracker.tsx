'use client'

import { useMemo } from 'react'

import { PositionBadge } from '@/components/players/position-badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { RosterSettings } from '@/lib/leagues/settings/league-settings'
import type { PlayerIdentity } from '@/hooks/use-players-by-ids'
import { cn } from '@/lib/utils'

import type { TeamBudget } from './auction-budget'
import { abbreviateName } from './draft-board-ops'
import { buildRosterTracker } from './roster-tracker-ops'

interface MyRosterTrackerProps {
  /** MY team's picks (the room filters by seat). */
  picks: ReadonlyArray<{ pick_number: number; player_id: string; is_undone: boolean | null }>
  playerById: ReadonlyMap<string, PlayerIdentity>
  roster: RosterSettings
  /** §16.4's "my picks" rail — slot chips only, no card chrome. */
  compact?: boolean
  /** AUCTION only (M3 task L.C3.2 item 3): what the remaining needs can
   *  COST — the §4.7 display-only mirror of `draft_team_budget` (084), passed
   *  in by the room so this component derives no money of its own. Null on a
   *  snake draft, and on an auction whose capacity is not derivable. */
  budget?: TeamBudget | null
  className?: string
}

/**
 * MyRosterTracker (§16.2 `my-roster-tracker`; §8.5.2 "my roster (slots
 * filling up)") — slots filling vs `roster_settings` plus the needs line.
 * Display-only read-model of 068's documented greedy (roster-tracker-ops.ts
 * — steps a–c); the server's autopick re-runs the same greedy
 * authoritatively, this never decides anything (D90). IR seats are not
 * draftable (D91) and deliberately don't render here.
 */
export function MyRosterTracker({
  picks,
  playerById,
  roster,
  compact = false,
  budget = null,
  className,
}: MyRosterTrackerProps) {
  const model = useMemo(
    () =>
      buildRosterTracker({
        picks,
        positionById: new Map(
          Array.from(playerById.values()).map((p) => [p.id, p.position]),
        ),
        startingSlots: roster.starting_slots,
        bench: roster.bench,
      }),
    [picks, playerById, roster],
  )

  const body = (
    <div className="flex flex-col gap-1.5">
      <p className="text-[11px] font-bold">
        {model.unfilled === 0 ? (
          'Every starting seat is covered.'
        ) : (
          <>
            <span className="fs-num">{model.unfilled}</span> starting{' '}
            {model.unfilled === 1 ? 'seat' : 'seats'} still to fill
          </>
        )}
      </p>

      {/* L.C3.2 item 3 — the needs surface's AUCTION context: what is left to
          spend on them (§8.6.1's remaining budget + max bid, and the spots
          those dollars must still cover). Absent on a snake draft, where
          there is no money to report. */}
      {budget && (
        <p className="text-[11px] font-bold">
          <span className="fs-num">${budget.remaining}</span> left · max bid{' '}
          <span className="fs-num">${budget.maxBid}</span> ·{' '}
          <span className="fs-num">{budget.openSlots}</span>{' '}
          {budget.openSlots === 1 ? 'spot' : 'spots'} to fill
        </p>
      )}

      {model.slots.map((slot) => (
        <div key={slot.key} className="flex items-start gap-2">
          <span className="fs-overline w-14 shrink-0 pt-0.5 text-[9px] text-n-3">
            {slot.label}
          </span>
          <div className="flex min-w-0 flex-1 flex-wrap gap-1">
            {slot.playerIds.map((playerId) => {
              const player = playerById.get(playerId)
              return (
                <span
                  key={playerId}
                  className="flex items-center gap-1 rounded-sm border border-ink bg-white px-1.5 py-0.5 text-[10px] font-bold"
                >
                  {player && <PositionBadge position={player.position} size="sm" />}
                  <span className="max-w-[110px] truncate">
                    {player ? abbreviateName(player.full_name) : playerId}
                  </span>
                </span>
              )
            })}
            {Array.from({ length: Math.max(0, slot.count - slot.playerIds.length) }).map(
              (_, i) => (
                <span
                  key={`open-${i}`}
                  className="rounded-sm border border-dashed border-n-3 px-1.5 py-0.5 text-[10px] font-medium text-n-3"
                >
                  Open
                </span>
              ),
            )}
          </div>
        </div>
      ))}

      <div className="flex items-start gap-2">
        <span className="fs-overline w-14 shrink-0 pt-0.5 text-[9px] text-n-3">Bench</span>
        <p className="min-w-0 flex-1 text-[10px] font-medium text-n-3">
          <span className="fs-num font-bold text-ink">{model.benchIds.length}</span> of{' '}
          <span className="fs-num">{model.benchCount}</span> filled
          {model.benchIds.length > 0 && (
            <>
              {' · '}
              {model.benchIds
                .map((id) => {
                  const player = playerById.get(id)
                  return player ? abbreviateName(player.full_name) : id
                })
                .join(', ')}
            </>
          )}
        </p>
      </div>

      {model.pendingIds.length > 0 && (
        <p className="text-[10px] font-medium text-n-3">
          <span className="fs-num">{model.pendingIds.length}</span> pick
          {model.pendingIds.length === 1 ? '' : 's'} loading…
        </p>
      )}
    </div>
  )

  if (compact) return <div className={className}>{body}</div>

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>My roster</CardTitle>
        <span className={cn('fs-overline text-[9px]', model.unfilled > 0 ? 'text-n-3' : 'text-positive-strong')}>
          {model.unfilled > 0 ? `${model.unfilled} open` : 'Set'}
        </span>
      </CardHeader>
      <CardContent>{body}</CardContent>
    </Card>
  )
}
