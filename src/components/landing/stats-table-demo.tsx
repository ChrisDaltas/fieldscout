'use client'

import { useEffect, useRef, useState } from 'react'

import { PosTag, WindowBar } from '@/components/landing/landing-bits'
import {
  STAT_ADDS,
  STAT_BASE,
  STAT_COLUMNS,
  STAT_ROWS,
  type StatKey,
} from '@/components/landing/landing-data'
import { useDemoClock } from '@/hooks/use-demo-clock'
import { usePrefersReducedMotion } from '@/hooks/use-prefers-reduced-motion'
import { cn } from '@/lib/utils'

// Autoplay script: press Customize, tick the extra columns one by one,
// press Done, flash the new columns, hold, loop.
const T_PRESS = 1500
const T_OPEN = 1900
const T_CHECK = 2500
const STEP = 420
const T_DONE = T_CHECK + STAT_ADDS.length * STEP + 300
const T_CLOSE = T_DONE + 350
const T_FLASH = T_CLOSE + 1600
const T_END = T_CLOSE + 6500

interface View {
  open: boolean
  pressCustomize: boolean
  pressDone: boolean
  draft: StatKey[]
  applied: StatKey[]
  fresh: StatKey[]
}

function autoView(t: number): View {
  const k = t < T_CHECK ? 0 : Math.min(STAT_ADDS.length, Math.floor((t - T_CHECK) / STEP) + 1)
  return {
    open: t >= T_OPEN && t < T_CLOSE,
    pressCustomize: t >= T_PRESS && t < T_CLOSE,
    pressDone: t >= T_DONE && t < T_CLOSE,
    draft: [...STAT_BASE, ...STAT_ADDS.slice(0, k)],
    applied: t >= T_CLOSE ? [...STAT_BASE, ...STAT_ADDS] : STAT_BASE,
    fresh: t >= T_CLOSE && t < T_FLASH ? STAT_ADDS : [],
  }
}

const ORDER = STAT_COLUMNS.map((c) => c.key)
const inOrder = (keys: StatKey[]) => ORDER.filter((k) => keys.includes(k))

/**
 * Customizable stats table demo (Claude Design StatsTableDemo). Autoplays a
 * "customize columns" walkthrough; the moment the visitor touches it
 * (Customize, a column checkbox, a header sort) it hands over and stays
 * manual. Static demo data, not live stats.
 */
export function StatsTableDemo() {
  const reduced = usePrefersReducedMotion()
  const [manual, setManual] = useState<null | Omit<View, 'pressCustomize' | 'pressDone'>>(null)
  const [sortKey, setSortKey] = useState<StatKey>('tgt')
  const t = useDemoClock({ loopMs: T_END, playing: !manual && !reduced })
  const flashTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(flashTimer.current), [])

  const v: View = manual
    ? { ...manual, pressCustomize: manual.open, pressDone: false }
    : reduced
      ? autoView(T_FLASH)
      : autoView(t)

  const cols = STAT_COLUMNS.map((c, i) => ({ ...c, i })).filter((c) => v.applied.includes(c.key))
  const sk = v.applied.includes(sortKey) ? sortKey : 'tgt'
  const si = ORDER.indexOf(sk)
  const rows = [...STAT_ROWS].sort((a, b) => b.v[si] - a.v[si])
  const grid = `var(--fs-rank-col) minmax(var(--fs-player-col),1.8fr) repeat(${cols.length},minmax(64px,1fr))`
  // Phones get a slimmer rank + player column so stats show without scrolling.
  const gridVars = '[--fs-rank-col:24px] [--fs-player-col:132px] sm:[--fs-rank-col:36px] sm:[--fs-player-col:190px]'

  const openPanel = () =>
    setManual((m) => {
      const applied = m ? m.applied : STAT_BASE
      return { open: true, draft: [...applied], applied, fresh: [] }
    })
  const toggle = (key: StatKey) =>
    setManual((m) =>
      m
        ? { ...m, draft: m.draft.includes(key) ? m.draft.filter((k) => k !== key) : [...m.draft, key] }
        : m,
    )
  const done = () => {
    setManual((m) =>
      m
        ? { open: false, draft: m.draft, applied: inOrder(m.draft), fresh: m.draft.filter((k) => !m.applied.includes(k)) }
        : m,
    )
    clearTimeout(flashTimer.current)
    flashTimer.current = setTimeout(() => setManual((m) => (m ? { ...m, fresh: [] } : m)), 1600)
  }

  return (
    <div className="relative w-full overflow-hidden rounded-[22px] bg-white text-left font-inter text-fs-ink shadow-fs-float [font-variant-numeric:tabular-nums]">
      <WindowBar title="Players · Advanced stats" />

      <div className="flex flex-wrap items-center gap-3 px-4 py-4 sm:px-6 sm:py-[18px]">
        <span className="text-[22px] font-bold tracking-[-0.02em]">Wide receivers</span>
        <div className="flex rounded-fs-sm bg-fs-line p-0.5" aria-hidden="true">
          <div className="flex h-7 items-center rounded-[7px] bg-white px-3 text-[13px] font-semibold shadow-fs-seg">
            Season
          </div>
          <div className="flex h-7 items-center px-3 text-[13px] font-semibold text-fs-text-3">Last 3</div>
        </div>
        <div
          className="ml-auto hidden h-[34px] w-[200px] items-center rounded-[10px] bg-fs-page px-3 text-[14px] font-medium text-fs-text-4 md:flex"
          aria-hidden="true"
        >
          Search players
        </div>
        <button
          type="button"
          onClick={openPanel}
          aria-expanded={v.open}
          className={cn(
            'flex h-[34px] items-center gap-2 rounded-[10px] px-3.5 text-[14px] font-semibold transition-[background-color,box-shadow] max-md:ml-auto',
            v.pressCustomize
              ? 'bg-fs-blue-soft text-fs-blue-deep ring-[3px] ring-fs-blue/25'
              : 'bg-fs-page text-fs-ink',
          )}
        >
          <span className="flex flex-col gap-[3px]" aria-hidden="true">
            <span className="h-0.5 w-3.5 rounded-sm bg-current" />
            <span className="h-0.5 w-2.5 rounded-sm bg-current" />
            <span className="h-0.5 w-1.5 rounded-sm bg-current" />
          </span>
          Customize
          <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-pill bg-fs-ink px-1.5 text-[11.5px] font-bold text-white">
            {v.applied.length}
          </span>
        </button>
      </div>

      <div className="overflow-x-auto">
        <div className={gridVars} style={{ minWidth: 200 + cols.length * 70 }}>
          <div
            className="grid h-10 items-center border-y-1 border-fs-line bg-fs-raised px-4 text-[12px] sm:px-6 font-semibold text-fs-text-3"
            style={{ gridTemplateColumns: grid }}
          >
            <span>#</span>
            <span>Player</span>
            {cols.map((c) => (
              <button
                key={c.key}
                type="button"
                onClick={() => {
                  setSortKey(c.key)
                  if (!manual) setManual({ open: false, draft: v.applied, applied: v.applied, fresh: [] })
                }}
                className={cn(
                  'flex h-10 select-none items-center justify-end whitespace-nowrap pr-1 transition-colors duration-[600ms]',
                  c.key === sk ? 'text-fs-blue' : 'text-fs-text-3',
                  v.fresh.includes(c.key) ? 'bg-fs-blue-soft' : 'bg-transparent',
                )}
                aria-pressed={c.key === sk}
              >
                {c.label}
                {c.key === sk && ' ↓'}
              </button>
            ))}
          </div>
          {rows.map((r, n) => (
            <div
              key={r.name}
              className="grid h-12 items-center border-b-1 border-fs-page px-4 sm:px-6"
              style={{ gridTemplateColumns: grid }}
            >
              <span className="text-[13px] font-semibold text-fs-text-4">{n + 1}</span>
              <div className="flex min-w-0 items-center gap-2.5">
                <PosTag pos="WR" className="hidden sm:inline-flex" />
                <span className="truncate text-[14px] font-semibold sm:whitespace-nowrap sm:text-[15px]">{r.name}</span>
                <span className="hidden text-[12.5px] font-medium text-fs-text-3 sm:inline">{r.team}</span>
              </div>
              {cols.map((c) => (
                <span
                  key={c.key}
                  className={cn(
                    'flex h-12 items-center justify-end pr-1 text-[14.5px] transition-colors duration-[600ms]',
                    c.key === sk ? 'font-bold text-fs-blue' : 'font-medium text-fs-ink',
                    v.fresh.includes(c.key) ? 'bg-fs-blue-wash' : 'bg-transparent',
                  )}
                >
                  {c.fmt(r.v[c.i])}
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>
      <div className="px-6 py-3.5 text-[12.5px] font-medium text-fs-text-3">Top 10 of 128 WRs · Weeks 1–3</div>

      {/* Column picker — a popover over the table, so it rests on its shadow. */}
      <div
        className={cn(
          'absolute right-3 top-[100px] w-[min(460px,calc(100%-24px))] rounded-[16px] bg-white p-5 shadow-fs-pop transition-[opacity,transform] sm:right-6',
          v.open ? 'pointer-events-auto translate-y-0 opacity-100' : 'pointer-events-none -translate-y-2 opacity-0',
        )}
        aria-hidden={!v.open}
      >
        <div className="flex items-baseline">
          <span className="text-[17px] font-bold">Columns</span>
          <span className="ml-auto text-[12.5px] font-medium text-fs-text-3">{v.draft.length} selected</span>
        </div>
        <div className="mt-3.5 grid grid-cols-2 gap-x-4 gap-y-1">
          {STAT_COLUMNS.map((c) => {
            const on = v.draft.includes(c.key)
            return (
              <button
                key={c.key}
                type="button"
                role="checkbox"
                aria-checked={on}
                tabIndex={v.open ? 0 : -1}
                onClick={() => toggle(c.key)}
                className="flex h-[38px] items-center gap-2.5 rounded-[10px] px-2 text-left hover:bg-fs-page"
              >
                <span
                  className={cn(
                    'flex size-5 flex-none items-center justify-center rounded-[6px] border-[1.5px] text-[12px] font-extrabold transition-colors duration-150',
                    on ? 'border-fs-blue bg-fs-blue text-white' : 'border-fs-fill-off bg-white text-transparent',
                  )}
                >
                  ✓
                </span>
                <span className="min-w-0">
                  <span className="block text-[14px] font-semibold">{c.label}</span>
                  <span className="block text-[11.5px] font-medium text-fs-text-4">{c.group}</span>
                </span>
              </button>
            )
          })}
        </div>
        <button
          type="button"
          tabIndex={v.open ? 0 : -1}
          onClick={done}
          className={cn(
            'mt-4 flex h-11 w-full items-center justify-center rounded-pill text-[15px] font-semibold text-white transition-colors duration-150 hover:bg-fs-blue-hover',
            v.pressDone ? 'bg-fs-blue-hover' : 'bg-fs-blue',
          )}
        >
          Done
        </button>
      </div>
    </div>
  )
}
