'use client'

import { MHeadshot } from '@/components/mobile/ui/m-headshot'
import { posLabel, posTextClass } from '@/components/mobile/ui/m-pos-chip'
import { cn } from '@/lib/utils'

import { CHEVRON_DOWN, PathIcon } from './players-chrome'
import { BLANK, cellBg, cellFg, colDef, groupRuns, type Cell, type ColKey } from './players-ops'

/**
 * FieldScout Mobile — the Players tab's three renderings of the same rows
 * (spec m-players §2.4 List, §2.5 Cards "Stats under each player", §2.6
 * Sheet). Headshots are not tappable; the name block opens the player
 * profile; a stat cell (List / Cards) or a Sheet column header opens the
 * column tip. Each List / Cards strip scrolls on its own; only the Sheet
 * moves every row's stats together.
 */

export interface ViewRow {
  id: string
  player: { id: string; full_name: string; position: string; team: string | null; headshot_url: string | null }
  short: string
  /** Q / D / O / IR — 10px/700 red beside the team. */
  status: string | null
  /** List view line 2 and line 3 (null = no line). */
  line2: React.ReactNode
  line3: React.ReactNode
  /** Cards view line 2. */
  cardLine: React.ReactNode
  cells: Partial<Record<ColKey, Cell>>
}

export interface ViewProps {
  rows: readonly ViewRow[]
  cols: readonly ColKey[]
  sort: ColKey
  /** The row's action circle at 28px (List / Cards) or 22px (Sheet);
   *  omitted = no action column (the viewer can't act here). */
  action?: (row: ViewRow, size: 28 | 22) => React.ReactNode
  /** How many controls the action slot holds: 1 (the league circle) or 2
   *  (research's star + add-to-list) — widens the Cards strip inset and the
   *  Sheet's locked column by the second control. */
  actionSlots?: 1 | 2
  onOpen: (row: ViewRow) => void
  onTip: (key: ColKey) => void
  emptyText?: string
}

const EMPTY = 'No players match these filters'

function Empty({ text }: { text: string }) {
  return <div className="py-9 text-center text-[13px] font-medium text-m-t3" data-players-empty>{text}</div>
}

/** Line 1: short name, position (its text colour), team, injury tag. */
function NameLine({ row, onOpen, nameClass }: { row: ViewRow; onOpen: () => void; nameClass: string }) {
  return (
    <span className="flex min-w-0 items-baseline gap-[5px] whitespace-nowrap">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onOpen()
        }}
        className={cn('min-w-0 truncate text-left font-semibold text-m-t1', nameClass)}
      >
        {row.short}
      </button>
      <span className={cn('flex-none text-[10px] font-semibold', posTextClass(row.player.position))}>{posLabel(row.player.position)}</span>
      {row.player.team && <span className="flex-none text-[10px] font-medium text-m-t3">{row.player.team}</span>}
      {row.status && <span className="flex-none text-[10px] font-bold text-m-red">{row.status}</span>}
    </span>
  )
}

const META = 'truncate text-[11px] font-medium text-m-t3'
const FADE = { maskImage: 'linear-gradient(90deg,#000 88%,transparent)', WebkitMaskImage: 'linear-gradient(90deg,#000 88%,transparent)' }

export function ListView({ rows, cols, action, onOpen, onTip, emptyText = EMPTY }: ViewProps) {
  return (
    <div className="px-3 pb-5" data-players-view="list">
      {rows.map((row) => (
        <div key={row.id} className="flex min-h-[58px] items-center gap-[9px] border-b border-m-b2 py-1.5" data-player-row={row.id}>
          {action?.(row, 28)}
          <MHeadshot player={row.player} size={36} />
          {/* The whole name block opens the profile (the name is the
              keyboard-reachable button inside it). */}
          <div className="flex w-[150px] min-w-0 flex-none cursor-pointer flex-col gap-px" onClick={() => onOpen(row)}>
            <NameLine row={row} onOpen={() => onOpen(row)} nameClass="text-[14px]" />
            {row.line2 && <span className={META}>{row.line2}</span>}
            {row.line3 && <span className={META}>{row.line3}</span>}
          </div>
          <div className="-mr-3 flex min-w-0 flex-1 gap-0.5 overflow-x-auto pr-3 scrollbar-none" style={FADE}>
            {cols.map((key) => {
              const c = row.cells[key] ?? BLANK
              const def = colDef(key)
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => onTip(key)}
                  aria-label={`${def.name}: ${c.text}`}
                  className="flex w-11 flex-none flex-col items-end gap-px"
                >
                  <span className="whitespace-nowrap text-[9px] font-semibold text-m-t3">{def.abbr}</span>
                  <span className={cn('whitespace-nowrap text-[14px] font-semibold tabular-nums', cellFg(c))}>{c.text}</span>
                </button>
              )
            })}
          </div>
        </div>
      ))}
      {rows.length === 0 && <Empty text={emptyText} />}
    </div>
  )
}

/** Cards strip inset: under the headshot (one 28px control + 9px gap, spec
 *  §2.5's 37px; a second control adds 28 + 4). */
const CARDS_INSET = { 1: 'pl-[37px]', 2: 'pl-[69px]' } as const
/** Sheet locked column: 156px (spec §2.6); a second 22px control adds 26. */
const SHEET_LEAD = { 1: 156, 2: 182 } as const

export function CardsView({ rows, cols, action, actionSlots = 1, onOpen, onTip, emptyText = EMPTY }: ViewProps) {
  return (
    <div className="px-3 pb-5" data-players-view="cards">
      {rows.map((row) => (
        <div key={row.id} className="flex flex-col gap-2 border-b border-m-b2 py-2.5" data-player-row={row.id}>
          <div className="flex items-center gap-[9px]">
            {action?.(row, 28)}
            <MHeadshot player={row.player} size={36} />
            <div className="flex min-w-0 flex-1 cursor-pointer flex-col gap-px" onClick={() => onOpen(row)}>
              <NameLine row={row} onOpen={() => onOpen(row)} nameClass="text-[14px]" />
              {row.cardLine && <span className={META}>{row.cardLine}</span>}
            </div>
          </div>
          <div className={cn('-mr-3 flex gap-4 overflow-x-auto pr-3 scrollbar-none', action ? CARDS_INSET[actionSlots] : 'pl-0')}>
            {cols.map((key) => {
              const c = row.cells[key] ?? BLANK
              const def = colDef(key)
              return (
                <button key={key} type="button" onClick={() => onTip(key)} aria-label={`${def.name}: ${c.text}`} className="flex flex-none flex-col gap-px text-left">
                  <span className="whitespace-nowrap text-[10px] font-medium text-m-t3">{def.abbr}</span>
                  <span className={cn('whitespace-nowrap text-[13px] font-semibold tabular-nums', cellFg(c))}>{c.text}</span>
                </button>
              )
            })}
          </div>
        </div>
      ))}
      {rows.length === 0 && <Empty text={emptyText} />}
    </div>
  )
}

export function SheetView({ rows, cols, sort, action, actionSlots = 1, onOpen, onTip, emptyText = EMPTY }: ViewProps) {
  const runs = groupRuns(cols)
  const lead = { width: SHEET_LEAD[action ? actionSlots : 1] }
  return (
    <div className="overflow-x-auto pb-5 scrollbar-none" data-players-view="sheet">
      <div className="inline-flex min-w-full flex-col pr-3">
        {/* Group bands — one per consecutive run of a group. */}
        <div className="flex items-end">
          <div className="sticky left-0 z-[2] flex-none self-stretch bg-m-b0" style={lead} />
          {runs.map((run, i) => (
            <div
              key={`${run.group}:${i}`}
              className="flex-none truncate border-l border-m-b3 pb-1 pl-1.5 pr-1 text-[10px] font-semibold text-m-t1"
              style={{ width: run.n * 50 }}
            >
              {run.label}
            </div>
          ))}
        </div>
        {/* Column headers: a tap opens the column tip (it never sorts). */}
        <div className="flex h-[26px] items-center border-b border-m-b3">
          <div className="sticky left-0 z-[2] flex h-full flex-none items-center bg-m-b0 pl-3 text-[10px] font-semibold text-m-t3" style={lead}>
            Player
          </div>
          {cols.map((key) => {
            const sorted = key === sort
            const def = colDef(key)
            return (
              <button
                key={key}
                type="button"
                onClick={() => onTip(key)}
                aria-label={`${def.name}${sorted ? ', sorted high to low' : ''}`}
                className={cn('flex w-[50px] flex-none items-center justify-center gap-0.5 whitespace-nowrap text-[10px] font-semibold', sorted ? 'text-accent' : 'text-m-t3')}
              >
                {def.abbr}
                {sorted && <PathIcon d={CHEVRON_DOWN} size={8} stroke={2.6} />}
              </button>
            )
          })}
        </div>
        {rows.map((row) => (
          <div key={row.id} className="flex h-[46px] items-center border-b border-m-b1" data-player-row={row.id}>
            {/* The locked player column — slides under the header and dock. */}
            <div className="sticky left-0 z-[1] flex h-full flex-none items-center gap-1.5 border-r border-m-b3 bg-m-b0 pl-3" style={lead}>
              {action?.(row, 22)}
              <MHeadshot player={row.player} size={26} />
              <div className="flex min-w-0 flex-1 cursor-pointer flex-col pr-1.5" onClick={() => onOpen(row)}>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    onOpen(row)
                  }}
                  className="truncate text-left text-[12px] font-semibold text-m-t1"
                >
                  {row.short}
                </button>
                <span className={cn('whitespace-nowrap text-[9.5px] font-semibold', posTextClass(row.player.position))}>
                  {posLabel(row.player.position)} <span className="font-medium text-m-t3">{row.player.team ?? ''}</span>
                </span>
              </div>
            </div>
            {cols.map((key) => {
              const c = row.cells[key] ?? BLANK
              return (
                <div key={key} className="w-[50px] flex-none px-0.5">
                  <div className={cn('flex h-6 items-center justify-center rounded-[6px] text-[12px] font-semibold tabular-nums', cellFg(c), cellBg(c, key === sort))}>
                    {c.text}
                  </div>
                </div>
              )
            })}
          </div>
        ))}
      </div>
      {rows.length === 0 && <Empty text={emptyText} />}
    </div>
  )
}

/** The view the store names. */
export function PlayersRows({ view, ...props }: ViewProps & { view: 'list' | 'cards' | 'sheet' }) {
  if (view === 'cards') return <CardsView {...props} />
  if (view === 'sheet') return <SheetView {...props} />
  return <ListView {...props} />
}
