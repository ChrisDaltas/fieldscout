'use client'

import { useMemo } from 'react'

import { cn } from '@/lib/utils'

import { abbreviateName, buildBoardModel, pickLabel, type BoardModelInput } from './draft-board-ops'
import { DraftPick } from './draft-pick'

/** Player identity the grid renders in made cells (world-readable players). */
export interface BoardPlayer {
  id: string
  full_name: string
  position: string
  team: string | null
}

interface DraftBoardGridProps {
  model: BoardModelInput
  /** Franchise names keyed by team id (column headers + cell bylines). */
  teamNameById: ReadonlyMap<string, string>
  playerById: ReadonlyMap<string, BoardPlayer>
  /** My seat — its column gets the resting accent treatment. */
  myTeamId: string | null
  className?: string
}

/**
 * DraftBoardGrid (§16.2) — the rounds × teams pick grid (§8.5.2). Purely
 * presentational over `buildBoardModel` (draft-board-ops.ts): made cells are
 * `draft_picks` rows, open cells carry the D90 parity-pinned predicted
 * owner, the on-clock cell is the one the drafts row names.
 *
 * Wide by construction (n columns at 8–16 teams), so the grid scrolls
 * INSIDE its own overflow-x container — the page never scrolls sideways
 * (CLAUDE.md responsive rule); §16.4's mobile treatment (ticker + rail,
 * grid one tap away) lives in the room, not here.
 */
export function DraftBoardGrid({
  model: input,
  teamNameById,
  playerById,
  myTeamId,
  className,
}: DraftBoardGridProps) {
  const model = useMemo(() => buildBoardModel(input), [input])

  if (model.rows.length === 0) return null

  const teamCount = model.order.length

  return (
    // R270 discharged (DR.4; F55's first named member): M2 shipped this as
    // `role="table"` with `role="columnheader"` children and NO row/cell
    // structure — invalid ARIA (headers with no rows misdescribe the tree
    // to AT). Per the reviewer's sanctioned shape it is now an aria-label'd
    // REGION: a focusable scroll container (keyboard users can scroll the
    // wide grid; the focus style is the house Button ring), with the
    // header/cell divs role-less visual content. Full `grid`/`row`/`cell`
    // semantics (display:contents rows) remain M7's option if the F55 sweep
    // wants table navigation — that is an enhancement, not a defect.
    <div
      className={cn(
        'overflow-x-auto focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
        className,
      )}
      role="region"
      aria-label="Draft board"
      tabIndex={0}
    >
      <div
        className="grid min-w-max gap-1"
        style={{ gridTemplateColumns: `repeat(${teamCount}, minmax(96px, 1fr))` }}
      >
        {/* Column headers — the stored round-1 order. */}
        {model.order.map((teamId) => (
          <div
            key={teamId}
            className={cn(
              'truncate rounded-sm border border-ink px-1.5 py-1 text-center text-[10px] font-extrabold leading-tight',
              teamId === myTeamId ? 'bg-accent-soft' : 'bg-white',
            )}
            title={teamNameById.get(teamId) ?? 'Team'}
          >
            {teamNameById.get(teamId) ?? 'Team'}
          </div>
        ))}

        {model.rows.map((row) =>
          row.map((cell) => {
            const player = cell.playerId ? playerById.get(cell.playerId) : undefined
            const made = cell.playerId !== null
            return (
              <DraftPick
                key={cell.pickNumber}
                pick={cell.pickNumber}
                empty={!made}
                onClock={cell.isOnClock}
                playerName={
                  made
                    ? player
                      ? abbreviateName(player.full_name)
                      : (cell.playerId ?? undefined)
                    : undefined
                }
                position={player?.position}
                team={player?.team ?? '—'}
                byManager={
                  made && cell.teamId ? (teamNameById.get(cell.teamId) ?? null) : null
                }
                label={pickLabel(cell.pickNumber, teamCount)}
              />
            )
          }),
        )}
      </div>
    </div>
  )
}
