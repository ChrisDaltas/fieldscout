'use client'

import { MobileSheet } from '@/components/mobile/ui/mobile-sheet'

import { SheetRow, type RowStats } from './lineup-rows'
import { swapIsEmpty, type SwapCandidate, type SwapOptions } from './swap-ops'

/**
 * The "Swap player" sheet (handoff League › Team §2.2): the tapped seat in a
 * b1 card, the "Choose a player to swap" divider, the seats he can trade
 * places with, then "Bench" (and the app's "Reserve" IR seats). A tap runs
 * the move through the lineup's save queue and closes the sheet; the toast
 * comes when the server has saved it. Own team only: "Drop player" under the
 * list (the app's lone-drop verb, confirmed in its own sheet).
 */
export function SwapSheet({
  open,
  onOpenChange,
  options,
  stats,
  onPick,
  drop,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  options: SwapOptions | null
  stats: RowStats
  onPick: (candidate: SwapCandidate) => void
  /** Own team, a filled seat: Drop, or why it can't be dropped now. */
  drop?: { name: string; onDrop: (() => void) | null; reason: string | null } | null
}) {
  return (
    <MobileSheet open={open} onOpenChange={onOpenChange} title="Swap player">
      {options && (
        <div className="px-3 pb-2" data-swap-sheet>
          <div className="rounded-[14px] bg-m-b1 p-0.5">
            <SheetRow
              slot={options.selected.slot}
              player={options.selected.player}
              stats={stats}
              label={options.selected.player ? `Selected: ${options.selected.player.full_name}` : 'Selected: empty seat'}
            />
          </div>
          <div className="flex items-center gap-[10px] px-2 pb-1.5 pt-[14px]" aria-hidden>
            <span className="h-px flex-1 bg-m-b3" />
            <span className="text-[12px] font-semibold text-m-t3">Choose a player to swap</span>
            <span className="h-px flex-1 bg-m-b3" />
          </div>
          {options.kind === 'locked' ? (
            <p className="px-2 py-4 text-center text-[13px] font-medium text-m-t3" role="status" data-swap-locked>
              {options.message}
            </p>
          ) : swapIsEmpty(options) ? (
            <p className="px-2 py-4 text-center text-[13px] font-medium text-m-t3" data-swap-empty>
              No eligible players for this slot
            </p>
          ) : (
            <>
              {options.starters.map((c) => (
                <Candidate key={c.id} c={c} stats={stats} onPick={onPick} />
              ))}
              {options.bench.length > 0 && (
                <>
                  <p className="px-2 pb-1 pt-3 text-[13px] font-semibold">Bench</p>
                  {options.bench.map((c) => (
                    <Candidate key={c.id} c={c} stats={stats} onPick={onPick} />
                  ))}
                </>
              )}
              {options.reserve.length > 0 && (
                <>
                  <p className="px-2 pb-1 pt-3 text-[13px] font-semibold">Reserve</p>
                  {options.reserve.map((c) => (
                    <Candidate key={c.id} c={c} stats={stats} onPick={onPick} />
                  ))}
                </>
              )}
            </>
          )}
          {drop && (
            <div className="flex flex-col items-stretch gap-1.5 px-1 pt-4">
              <button
                type="button"
                disabled={!drop.onDrop}
                onClick={drop.onDrop ?? undefined}
                className="h-11 rounded-pill bg-m-gr text-[14px] font-semibold text-m-tr disabled:opacity-50"
                data-swap-drop
              >
                Drop {drop.name}
              </button>
              {drop.reason && <p className="text-center text-[11px] font-medium text-m-t3">{drop.reason}</p>}
            </div>
          )}
        </div>
      )}
    </MobileSheet>
  )
}

function Candidate({ c, stats, onPick }: { c: SwapCandidate; stats: RowStats; onPick: (c: SwapCandidate) => void }) {
  return <SheetRow slot={c.row.slot} player={c.row.player} stats={stats} onClick={() => onPick(c)} label={c.toast} />
}
