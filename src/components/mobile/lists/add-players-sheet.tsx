'use client'

import * as React from 'react'

import { MHeadshot } from '@/components/mobile/ui/m-headshot'
import { MIcon } from '@/components/mobile/ui/m-icon'
import { MobileSheet } from '@/components/mobile/ui/mobile-sheet'
import { posLabel, posTextClass } from '@/components/mobile/ui/m-pos-chip'
import { useAddPlayer, useRemovePlayer, useSetPlayerTier, type ListWithDetails } from '@/hooks/use-lists'
import { poolPositions, useMobileListsPool, type PoolPlayer } from '@/hooks/use-mobile-lists-pool'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'

import { lastTierLetter } from './lists-model'
import { CenterNote, PillButton } from './lists-parts'

/**
 * FieldScout Mobile — Add players (lr-lists §2.4, states L5/L5a): search, a
 * position chip row, and every player in the pool with a +/✓ circle. A tap
 * adds or removes at once (the app writes every change immediately); Done
 * only closes. Added players go to the end of the list — and, on a tiered
 * list, into its last tier, as the design's append does.
 *
 * The pool is the desktop popover's (`/api/players/builder`, projection order);
 * the design's "Scout AI #N" has no source in the app and is left out. The
 * search matches a name or an exact team code and is trimmed (lr-lists gap 15).
 */

const ALL_CHIPS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'] as const
const passThrough = <T,>(write: Promise<T>): Promise<T> => write
const PAGE = 40

export function AddPlayersSheet({
  open,
  onOpenChange,
  list,
  tiersOn,
  track = passThrough,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  list: ListWithDetails
  tiersOn: boolean
  /** The editor's write tracker, so its Done waits for these writes too. */
  track?: <T>(write: Promise<T>) => Promise<T>
}) {
  const positions = poolPositions(list.position_filter)
  const pool = useMobileListsPool(positions, true)
  const add = useAddPlayer(list.id)
  const remove = useRemovePlayer(list.id)
  const setTier = useSetPlayerTier(list.id)
  const [q, setQ] = React.useState('')
  const [pos, setPos] = React.useState<string>('All')
  const [limit, setLimit] = React.useState(PAGE)
  const [adding, setAdding] = React.useState<ReadonlySet<string>>(new Set())
  const sentinel = React.useRef<HTMLDivElement | null>(null)

  // The search and filter reset on every open (lr-lists §3).
  React.useEffect(() => {
    if (!open) return
    setQ('')
    setPos('All')
    setLimit(PAGE)
  }, [open])

  const inList = React.useMemo(() => new Set(list.players.map((entry) => entry.player_id)), [list.players])
  const chips = positions ? positions : ALL_CHIPS

  const needle = q.trim().toLowerCase()
  const rows = React.useMemo(() => {
    return (pool.data ?? []).filter((player) => {
      if (pos !== 'All' && player.position !== pos) return false
      if (!needle) return true
      return player.full_name.toLowerCase().includes(needle) || (player.team ?? '').toLowerCase() === needle
    })
  }, [pool.data, pos, needle])

  React.useEffect(() => setLimit(PAGE), [needle, pos])

  // Grow the rendered rows as the end comes into view (the pool is the whole
  // league — rendering every headshot at once would stall a phone).
  React.useEffect(() => {
    const node = sentinel.current
    if (!node || !open) return
    const io = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) setLimit((n) => n + PAGE)
    })
    io.observe(node)
    return () => io.disconnect()
  }, [open, rows.length, limit])

  const toggle = (player: PoolPlayer) => {
    if (inList.has(player.id)) {
      track(remove.mutateAsync(player.id)).catch((error: Error) =>
        toast({ title: 'Could not remove that player', description: error.message }),
      )
      return
    }
    if (adding.has(player.id)) return
    setAdding((prev) => new Set(prev).add(player.id))
    const letter = tiersOn ? lastTierLetter(list.players) : null
    const write = add.mutateAsync(player.id).then(
      async () => {
        if (!letter) return
        await setTier.mutateAsync({ playerId: player.id, tier: letter }).catch((error: Error) => {
          toast({ title: `${player.full_name} was added but not placed in the last tier`, description: error.message })
          throw error
        })
      },
      (error: Error & { status?: number }) => {
        // A 409 means he is already on the list — the toast, not a failure.
        if (error.status === 409) {
          toast({ title: `${player.full_name} is already on this list` })
          return
        }
        toast({ title: 'Could not add that player', description: error.message })
        throw error
      },
    )
    track(write)
      .catch(() => undefined)
      .finally(() =>
        setAdding((prev) => {
          const next = new Set(prev)
          next.delete(player.id)
          return next
        }),
      )
  }

  const count = list.players.length + [...adding].filter((id) => !inList.has(id)).length

  return (
    <MobileSheet bodyClassName="leading-[normal] tabular-nums" open={open} onOpenChange={onOpenChange} title="Add players" subtitle={`${count} in your list`} showClose>
      <div className="sticky top-0 z-[1] flex flex-col gap-2 bg-m-b0 px-4 pb-2">
        <label className="flex h-10 items-center gap-2 rounded-xl bg-m-b2 px-3">
          <MIcon name="search" size={15} stroke={1.8} className="text-m-t4" />
          <input
            value={q}
            onChange={(event) => setQ(event.target.value)}
            placeholder="Search players"
            aria-label="Search players"
            className="min-w-0 flex-1 bg-transparent text-[15px] font-medium text-m-t1 outline-none placeholder:text-m-t3"
          />
        </label>
        <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 scrollbar-none">
          {['All', ...chips].map((chip) => {
            const on = pos === chip
            return (
              <button
                key={chip}
                type="button"
                aria-pressed={on}
                onClick={() => setPos(chip)}
                className={cn(
                  'flex h-[30px] flex-none items-center rounded-pill px-3 text-[12px] font-semibold',
                  on ? 'bg-m-ink text-white' : 'bg-m-b2 text-m-t1 active:bg-m-b2h',
                )}
              >
                {chip === 'All' ? 'All' : posLabel(chip)}
              </button>
            )
          })}
        </div>
      </div>
      <div className="px-4">
        {pool.isError ? (
          <CenterNote
            className="py-8"
            title="Players could not be loaded."
            body={pool.error.message}
            action={<PillButton onClick={() => void pool.refetch()}>Try again</PillButton>}
          />
        ) : !pool.isSuccess ? (
          <div aria-busy="true" aria-label="Loading players">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="flex items-center gap-2.5 border-b border-m-b2 py-2">
                <span className="size-[34px] animate-pulse rounded-full bg-m-b1" />
                <span className="h-3 w-1/2 animate-pulse rounded-md bg-m-b1" />
              </div>
            ))}
          </div>
        ) : rows.length === 0 ? (
          <p className="py-8 text-center text-[13px] font-medium text-m-t3">No players found.</p>
        ) : (
          <>
            {rows.slice(0, limit).map((player) => {
              const on = inList.has(player.id) || adding.has(player.id)
              return (
                <button
                  key={player.id}
                  type="button"
                  onClick={() => toggle(player)}
                  aria-pressed={on}
                  aria-label={`${on ? 'Remove' : 'Add'} ${player.full_name}`}
                  className="flex w-full items-center gap-2.5 border-b border-m-b2 py-2 text-left"
                >
                  <MHeadshot player={player} size={34} />
                  <span className="flex min-w-0 flex-1 flex-col gap-px">
                    <span className="truncate text-[14px] font-semibold text-m-t1">{player.full_name}</span>
                    <span className={cn('text-[11px] font-semibold', posTextClass(player.position))}>
                      {posLabel(player.position)} <span className="font-medium text-m-t3">{player.team ?? 'FA'}</span>
                    </span>
                  </span>
                  <span
                    className={cn(
                      'flex size-7 flex-none items-center justify-center rounded-full text-white',
                      on ? 'bg-accent' : 'bg-m-ink',
                    )}
                  >
                    <MIcon name={on ? 'check' : 'plus'} size={12} stroke={2.6} />
                  </span>
                </button>
              )
            })}
            {limit < rows.length && <div ref={sentinel} className="h-10" aria-hidden />}
          </>
        )}
      </div>
    </MobileSheet>
  )
}
