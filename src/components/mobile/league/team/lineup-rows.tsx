'use client'

import { MHeadshot } from '@/components/mobile/ui/m-headshot'
import type { SlotInstance } from '@/components/leagues/lineup-editor-ops'
import type { RosterPlayer } from '@/lib/leagues/api/rosters-service'
import { cn } from '@/lib/utils'

import { BENCH_CHIP_CLASS, posCode, shortName, slotChipClass, slotCode, TONE_TEXT, type GameLine } from './team-ops'

/**
 * The lineup rows of the mobile Team tab, the Team view and the Swap player
 * sheet (handoff League › Team §2.1 C, §2.2, §2.3). Pure presentation: the
 * screen hands each row what it shows and what a tap does.
 */

/** What a row reads about a player (all server reads — "–" when absent). */
export interface RowStats {
  proj: (playerId: string) => number | null
  /** A week's points once his game is under way ("9.60"), else null. */
  points: (playerId: string) => string | null
  game: (nflTeam: string | null) => GameLine
  oprk: (line: GameLine, position: string) => { text: string; tone: keyof typeof TONE_TEXT } | null
  headshot: (playerId: string) => string | null
}

export function SlotChip({
  slot,
  size,
  ring = false,
  onClick,
  label,
  disabled,
}: {
  /** null = the bench chip ("BN"). */
  slot: SlotInstance | null
  size: 'tab' | 'sheet' | 'view'
  ring?: boolean
  onClick?: () => void
  label?: string
  disabled?: boolean
}) {
  const code = slot ? slotCode(slot) : 'BN'
  const cls = cn(
    'flex flex-none items-center justify-center text-[11px] font-semibold',
    size === 'tab' && 'h-[30px] w-11 rounded-[9px]',
    size === 'sheet' && 'h-7 w-11 rounded-[9px]',
    size === 'view' && 'h-[26px] w-10 rounded-md',
    slot ? slotChipClass(slot) : BENCH_CHIP_CLASS,
    // The swap target's ring (handoff T4): 2px white gap, 2px blue.
    ring && 'ring-2 ring-accent ring-offset-2 ring-offset-white',
  )
  if (!onClick) return <span className={cls}>{code}</span>
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-label={label ?? `Swap ${code}`} className={cn(cls, 'disabled:cursor-default')}>
      {code}
    </button>
  )
}

function EmptyAvatar({ size }: { size: number }) {
  return <span aria-hidden className="flex-none rounded-full ring-[1.5px] ring-inset ring-m-b3s" style={{ width: size, height: size }} />
}

function LockGlyph() {
  return (
    <svg viewBox="0 0 16 16" width={10} height={10} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" role="img" aria-label="Locked" className="mr-1 inline-block align-[-1px]">
      <path d="M4.5 7.5h7v6h-7zM6 7.5V5.5a2 2 0 0 1 4 0v2" />
    </svg>
  )
}

/** "RB · ATL (5)" — position · NFL team (bye week). */
export function metaText(p: RosterPlayer): string {
  const team = p.nfl_team ?? 'FA'
  return `${posCode(p.position)} · ${team}${p.bye_week !== null ? ` (${p.bye_week})` : ''}`
}

function GameAndRank({ player, stats, locked }: { player: RosterPlayer; stats: RowStats; locked: boolean }) {
  const line = stats.game(player.nfl_team)
  const rank = stats.oprk(line, player.position)
  const text = line.kind === 'unknown' ? '' : line.text
  return (
    <>
      {locked && <LockGlyph />}
      {text}
      {rank && (
        <>
          {' '}
          <span className={cn('font-semibold', TONE_TEXT[rank.tone])}>{rank.text}</span>
        </>
      )}
    </>
  )
}

/** A status tag beside a name ("Q", "O", "IR") — the feed's own words. */
function StatusTag({ status }: { status: string | null }) {
  const s = (status ?? '').trim().toLowerCase()
  const tag = s === 'questionable' ? 'Q' : s === 'doubtful' ? 'D' : s === 'out' ? 'O' : s === 'ir' ? 'IR' : null
  if (!tag) return null
  return <span className="ml-1 text-[11px] font-semibold text-negative-strong">{tag}</span>
}

/**
 * A Team tab row (handoff §2.1 C): 44×30 slot chip · 38px headshot · name
 * with "RB · ATL (5)" · game + opponent rank · points over projection.
 */
export function TabRow({
  slot,
  player,
  keptName,
  stats,
  locked,
  ring,
  onChip,
  onText,
  chipLabel,
}: {
  slot: SlotInstance | null
  player: RosterPlayer | null
  /** A dropped-after-he-played starter still holding the seat (kept). */
  keptName?: string | null
  stats: RowStats
  locked: boolean
  ring: boolean
  onChip?: () => void
  onText?: () => void
  chipLabel: string
}) {
  const pts = player ? stats.points(player.player_id) : null
  const proj = player ? stats.proj(player.player_id) : null
  return (
    <div className="flex items-center gap-[10px] border-b border-m-b2 px-1 py-[10px]" data-lineup-row={slot?.key ?? 'bn'}>
      <SlotChip slot={slot} size="tab" ring={ring} onClick={onChip} label={chipLabel} />
      {player ? <MHeadshot player={{ id: player.player_id, full_name: player.full_name, team: player.nfl_team, position: player.position, headshot_url: stats.headshot(player.player_id) }} size={38} /> : <EmptyAvatar size={38} />}
      <button
        type="button"
        onClick={onText}
        disabled={!onText}
        className="flex min-w-0 flex-1 flex-col gap-0.5 text-left disabled:cursor-default"
        // A filled or kept row is named by what it shows (name, meta, game
        // line, opponent rank); only the bare "Empty" row needs the label.
        aria-label={player || keptName ? undefined : chipLabel}
      >
        <span className={cn('truncate text-[14px] font-semibold', player || keptName ? 'text-m-t1' : 'text-m-t5')}>
          {player ? player.full_name : keptName ? keptName : 'Empty'}
          {player && <StatusTag status={player.status} />}
          {player && <span className="text-[11px] font-medium text-m-t3"> {metaText(player)}</span>}
        </span>
        {player && (
          <span className="truncate text-[11px] font-medium text-m-t3">
            <GameAndRank player={player} stats={stats} locked={locked} />
          </span>
        )}
        {!player && keptName && (
          <span className="truncate text-[11px] font-medium text-m-t3">
            <LockGlyph />
            Dropped after he played — the seat stays his this week
          </span>
        )}
      </button>
      <span className="flex flex-none flex-col items-end gap-px tabular-nums">
        <span className="text-[15px] font-semibold">{player ? (pts ?? '–') : ''}</span>
        <span className="text-[11px] font-medium text-m-t3">{player && proj !== null ? proj.toFixed(2) : ''}</span>
      </span>
    </div>
  )
}

/**
 * A Swap player sheet row (handoff §2.2): 44×28 chip · 34px headshot · short
 * name with meta · game + rank · projection. The whole row is the button.
 */
export function SheetRow({
  slot,
  player,
  stats,
  onClick,
  label,
}: {
  slot: SlotInstance | null
  player: RosterPlayer | null
  stats: RowStats
  onClick?: () => void
  label: string
}) {
  const proj = player ? stats.proj(player.player_id) : null
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="flex w-full items-center gap-[10px] rounded-[12px] px-1.5 py-2 text-left active:bg-m-b2"
      data-swap-row={slot?.key ?? (player ? `bn:${player.player_id}` : 'bn')}
    >
      <SlotChip slot={slot} size="sheet" />
      {player ? <MHeadshot player={{ id: player.player_id, full_name: player.full_name, team: player.nfl_team, position: player.position, headshot_url: stats.headshot(player.player_id) }} size={34} /> : <EmptyAvatar size={34} />}
      <span className="flex min-w-0 flex-1 flex-col gap-px">
        <span className={cn('truncate text-[14px] font-semibold', player ? 'text-m-t1' : 'text-m-t5')}>
          {player ? shortName(player.full_name, player.position) : 'Empty'}
          {player && <span className="text-[11px] font-medium text-m-t3"> {metaText(player)}</span>}
        </span>
        {player && (
          <span className="truncate text-[11px] font-medium text-m-t3">
            <GameAndRank player={player} stats={stats} locked={false} />
          </span>
        )}
      </span>
      <span className="flex-none text-[13px] font-semibold tabular-nums">{proj !== null ? proj.toFixed(2) : ''}</span>
    </button>
  )
}

/**
 * A Team view row (handoff §2.3 5): 40×26 chip · 34px headshot · full name
 * over "WR · PHI · Sun 4:25 PM vs SF" · projection.
 */
export function ViewRow({
  slot,
  player,
  keptName,
  stats,
  locked,
  ring,
  onChip,
  onText,
  chipLabel,
}: {
  slot: SlotInstance | null
  player: RosterPlayer | null
  keptName?: string | null
  stats: RowStats
  locked: boolean
  ring: boolean
  onChip?: () => void
  onText?: () => void
  chipLabel: string
}) {
  const proj = player ? stats.proj(player.player_id) : null
  const line = player ? stats.game(player.nfl_team) : null
  const meta = player ? [posCode(player.position), player.nfl_team ?? 'FA', line && line.kind !== 'unknown' ? line.text : null].filter(Boolean).join(' · ') : ''
  return (
    <div className="flex items-center gap-[10px] border-b border-m-b2 py-2" data-view-row={slot?.key ?? 'bn'}>
      <SlotChip slot={slot} size="view" ring={ring} onClick={onChip} label={chipLabel} />
      {player ? <MHeadshot player={{ id: player.player_id, full_name: player.full_name, team: player.nfl_team, position: player.position, headshot_url: stats.headshot(player.player_id) }} size={34} /> : <EmptyAvatar size={34} />}
      <button type="button" onClick={onText} disabled={!onText} className="flex min-w-0 flex-1 flex-col gap-px text-left disabled:cursor-default" aria-label={player || keptName ? undefined : chipLabel}>
        <span className={cn('truncate text-[14px] font-semibold', player || keptName ? 'text-m-t1' : 'text-m-t5')}>
          {player ? player.full_name : (keptName ?? 'Empty')}
          {player && <StatusTag status={player.status} />}
        </span>
        {(player || keptName) && (
          <span className="truncate text-[11px] font-medium text-m-t3">
            {locked && <LockGlyph />}
            {player ? meta : 'Dropped after he played — the seat stays his this week'}
          </span>
        )}
      </button>
      <span className="flex-none text-[13px] font-semibold tabular-nums">{player ? (proj !== null ? proj.toFixed(2) : '–') : '–'}</span>
    </div>
  )
}
