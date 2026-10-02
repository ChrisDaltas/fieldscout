'use client'

import { useEffect, useRef, useState } from 'react'

import { PosTag } from '@/components/landing/landing-bits'
import {
  POSITION_LABELS,
  TICKER_POSITIONS,
  tickerItems,
  type Pos,
} from '@/components/landing/landing-data'
import { usePrefersReducedMotion } from '@/hooks/use-prefers-reduced-motion'
import { cn } from '@/lib/utils'

/**
 * Week 4 projections ticker under the landing header. Scrolls one position
 * group across, then moves to the next (QB → RB → WR → TE). The filter
 * button picks a group directly. Reduced motion: a static, scrollable row.
 */
export function WeekTicker() {
  const [pos, setPos] = useState<Pos>('QB')
  const [run, setRun] = useState(0) // bumps to restart the scroll animation
  const [open, setOpen] = useState(false)
  const reduced = usePrefersReducedMotion()
  const menuRef = useRef<HTMLDivElement>(null)
  const items = tickerItems(pos)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const choose = (next: Pos) => {
    setPos(next)
    setRun((r) => r + 1)
    setOpen(false)
  }

  return (
    <div className="relative z-40 flex h-10 items-center gap-2.5 border-b-1 border-black/[.08] bg-white px-4 sm:px-10">
      <span className="inline-flex h-6 flex-none items-center rounded-pill bg-fs-ink px-2.5 text-[12px] font-bold text-white">
        Week 4
      </span>

      <div ref={menuRef} className="relative flex h-6 flex-none items-center">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={`Showing ${POSITION_LABELS[pos]}. Change position`}
          className={cn(
            'flex h-6 items-center gap-1.5 rounded-pill px-2.5 text-[12px] font-semibold text-fs-ink transition-colors hover:bg-fs-fill',
            open ? 'bg-fs-fill' : 'bg-fs-page',
          )}
        >
          <span className="flex flex-col items-center gap-0.5" aria-hidden="true">
            <span className="h-[1.5px] w-2.5 rounded-sm bg-current" />
            <span className="h-[1.5px] w-[7px] rounded-sm bg-current" />
            <span className="h-[1.5px] w-1 rounded-sm bg-current" />
          </span>
          {pos}
        </button>
        {open && (
          // Popover menu — a true overlay, so it rests on its shadow.
          <div
            role="menu"
            className="absolute left-0 top-8 w-[168px] rounded-fs-md bg-white p-1.5 shadow-fs-pop"
          >
            {TICKER_POSITIONS.map((p) => (
              <button
                key={p}
                type="button"
                role="menuitemradio"
                aria-checked={p === pos}
                onClick={() => choose(p)}
                className={cn(
                  'flex h-[34px] w-full items-center gap-2.5 rounded-[8px] px-2.5 text-left hover:bg-fs-page',
                  p === pos && 'bg-fs-page',
                )}
              >
                <PosTag pos={p} className="min-w-[30px]" />
                <span className="text-[13.5px] font-semibold text-fs-ink">{POSITION_LABELS[p]}</span>
                {p === pos && (
                  <span className="ml-auto text-[12px] font-extrabold text-fs-blue">✓</span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      <div
        className={cn(
          'ml-1.5 min-w-0 flex-1 [mask-image:linear-gradient(to_right,transparent,#000_24px,#000_calc(100%-24px),transparent)]',
          reduced ? 'overflow-x-auto' : 'overflow-hidden',
        )}
        aria-label={`Week 4 projections, ${POSITION_LABELS[pos]}`}
      >
        <div
          key={`${pos}-${run}`}
          className={cn('flex w-max', !reduced && 'animate-fs-ticker')}
          style={
            reduced
              ? undefined
              : ({
                  animationDuration: `${Math.round(items.length * 3.2)}s`,
                  '--fs-ticker-from': 'calc(100vw - 200px)',
                } as React.CSSProperties)
          }
          onAnimationEnd={() =>
            choose(TICKER_POSITIONS[(TICKER_POSITIONS.indexOf(pos) + 1) % TICKER_POSITIONS.length])
          }
        >
          {items.map((k) => (
            <div key={k.code} className="flex flex-none items-center gap-2 pr-7">
              <PosTag pos={pos} className="min-w-[34px]">
                {k.code}
              </PosTag>
              <span className="whitespace-nowrap text-[13px] font-semibold text-fs-ink">{k.name}</span>
              <span className="whitespace-nowrap text-[12px] font-medium text-fs-text-3">{k.opp}</span>
              <span className="text-[12.5px] font-bold text-fs-blue">{k.proj}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
