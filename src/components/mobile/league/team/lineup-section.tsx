'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'

import { commishTeamHref } from '@/components/leagues/activity-page-ops'
import { LOCKED_DROP_TITLE } from '@/components/leagues/players-page-ops'
import { COMMISH_CHANGED_BADGE } from '@/components/leagues/team-commish-ops'
import type { SlotInstance, WeekEditability } from '@/components/leagues/lineup-editor-ops'
import { lineupProjection } from '@/components/mobile/league/match/match-ops'
import { MIcon } from '@/components/mobile/ui/m-icon'
import type { TeamLineupRow } from '@/hooks/use-lineup'
import type { RosterPlayer } from '@/lib/leagues/api/rosters-service'
import type { RosterSettings } from '@/lib/leagues/settings/league-settings'
import { cn } from '@/lib/utils'
import { usePlayerModalStore } from '@/stores/player-modal-store'

import { DropSheet } from './drop-sheet'
import { TabRow, ViewRow, type RowStats } from './lineup-rows'
import { SwapSheet } from './swap-sheet'
import { swapOptions, type SwapCandidate, type SwapSelection } from './swap-ops'
import { slotCode } from './team-ops'
import { useLineupMoves } from './use-lineup-moves'

/**
 * Starters + Bench of one team-week, mobile (handoff League › Team §2.1 B–E
 * and Team view §2.3 4–6), with "Tap a position to swap players" → the Swap
 * player sheet. Mount it keyed by team + week (one save queue per
 * team-week, R1467 — the desktop editor's rule).
 */
export interface LineupSectionProps {
  variant: 'tab' | 'view'
  leagueId: string
  teamId: string
  week: number
  settings: RosterSettings
  roster: readonly RosterPlayer[]
  stored: TeamLineupRow | null
  currentWeek: number | null
  editability: WeekEditability
  canEdit: boolean
  overrideMode: boolean
  isCommish: boolean
  onOverrideMode: (on: boolean) => void
  stats: RowStats
  /** A kept (dropped-after-he-played) starter's name by id. */
  keptName: (playerId: string) => string | null
  /** The week navigator (the Team tab; the Team view only while the
   *  commissioner is in override mode). */
  weekNav?: { prev: number | null; next: number | null; onWeek: (week: number) => void }
  /** Own team: Drop from the swap sheet (null = drops closed, with why). */
  drop?: { closedReason: string | null } | null
}

export function LineupSection(props: LineupSectionProps) {
  const { variant, leagueId, teamId, week, settings, roster, stored, currentWeek, editability, canEdit, overrideMode, isCommish, onOverrideMode, stats, keptName, weekNav, drop } = props
  const openPlayer = usePlayerModalStore((s) => s.openPlayerView)
  const lineup = useLineupMoves({ leagueId, teamId, week, settings, roster, stored, currentWeek, editability, canEdit, overrideMode })
  const { model, readOnly, locked, kept, saving } = lineup
  const [selection, setSelection] = useState<SwapSelection | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [dropping, setDropping] = useState<{ player_id: string; full_name: string } | null>(null)

  const options = useMemo(
    () => (selection ? swapOptions(selection, { placement: lineup.shown, slots: lineup.slots, players: lineup.players, bench: model.bench, ctx: lineup.ctx }) : null),
    [selection, lineup.shown, lineup.slots, lineup.players, model.bench, lineup.ctx],
  )

  const select = (sel: SwapSelection) => {
    if (readOnly) return
    setSelection(sel)
    setSheetOpen(true)
  }
  const pick = (c: SwapCandidate) => {
    setSheetOpen(false)
    lineup.move(c.move.playerId, c.move.target, c.toast)
  }
  const ringOn = (sel: SwapSelection) =>
    sheetOpen && selection !== null && selection.kind === sel.kind && JSON.stringify(selection) === JSON.stringify(sel)

  const benchSeats = Math.max(0, settings.bench - model.bench.length)
  // The Team view header's "Proj": the Match card's rule (`lineupProjection`)
  // over the starters on screen, a kept starter's seat counted as filled —
  // "–" unless every filled starter has a projection, so never a partial
  // sum, and never "0.00" while the projections load or after they failed.
  const starterProj = lineupProjection(
    model.starters.map((r) => r.player?.player_id ?? kept.get(r.slot.key) ?? null),
    stats.proj,
  )

  // Own team: the selected player's Drop (moves open, not locked).
  const selectedPlayer = options?.selected.player ?? null
  const dropAction =
    drop && selectedPlayer && variant === 'tab'
      ? (() => {
          const isLocked = locked.has(selectedPlayer.player_id)
          const reason = drop.closedReason ?? (isLocked ? LOCKED_DROP_TITLE : null)
          return {
            name: selectedPlayer.full_name,
            reason,
            onDrop: reason
              ? null
              : () => {
                  setSheetOpen(false)
                  setDropping({ player_id: selectedPlayer.player_id, full_name: selectedPlayer.full_name })
                },
          }
        })()
      : null

  const subtitle = readOnly
    ? !canEdit
      ? null
      : editability.state === 'closed'
        ? editability.reason
        : editability.state === 'unknown'
          ? 'This league has no schedule yet — lineups can be set once the season’s weeks are on the calendar.'
          : null
    : 'Tap a position to swap players'

  const Row = variant === 'tab' ? TabRow : ViewRow
  const chipFor = (sel: SwapSelection) => (readOnly ? undefined : () => select(sel))
  const textFor = (player: RosterPlayer | null, sel: SwapSelection) => (player ? () => openPlayer(player.player_id, leagueId) : readOnly ? undefined : () => select(sel))
  const chipLabel = (slot: SlotInstance | null, player: RosterPlayer | null) =>
    `${slot ? slotCode(slot) : 'Bench'}: ${player ? player.full_name : 'empty'}${readOnly ? '' : ' — swap'}`

  return (
    <div data-lineup-section={variant} data-saving={saving ? 'on' : 'off'}>
      {variant === 'tab' ? (
        <div className="flex items-end justify-between gap-3 px-4 pb-2 pt-[18px]">
          <div className="flex min-w-0 flex-col gap-0.5">
            <h2 className="text-[17px] font-semibold tracking-[-0.01em]">Starters</h2>
            {subtitle && <p className="text-[12px] font-medium text-m-t3">{subtitle}</p>}
          </div>
          {weekNav ? (
            <div className="flex flex-none items-center gap-0.5" data-week-nav>
              <WeekArrow dir="prev" week={weekNav.prev} disabled={saving} onWeek={weekNav.onWeek} />
              <span className="whitespace-nowrap text-[13px] font-semibold text-accent" aria-live="polite">
                Week {week}
              </span>
              <WeekArrow dir="next" week={weekNav.next} disabled={saving} onWeek={weekNav.onWeek} />
            </div>
          ) : (
            <span className="flex-none whitespace-nowrap text-[13px] font-semibold text-accent">Week {week}</span>
          )}
        </div>
      ) : (
        <div className="mt-[22px] flex items-center justify-between">
          <h2 className="text-[17px] font-semibold tracking-[-0.01em]">Starters</h2>
          <span className="flex items-center gap-0.5">
            {weekNav && <WeekArrow dir="prev" week={weekNav.prev} disabled={saving} onWeek={weekNav.onWeek} />}
            <span className="text-[12px] font-medium text-m-t3 tabular-nums" data-view-proj>
              Week {week} · Proj {starterProj ?? '–'}
            </span>
            {weekNav && <WeekArrow dir="next" week={weekNav.next} disabled={saving} onWeek={weekNav.onWeek} />}
          </span>
        </div>
      )}
      {variant === 'view' && canEdit && subtitle && <p className="pt-1 text-[12px] font-medium text-m-t3">{subtitle}</p>}

      {stored?.edited_by_commish && (
        <Link href={commishTeamHref(leagueId, teamId)} className={cn('block text-[12px] font-semibold text-accent', variant === 'tab' ? 'px-4 pb-2' : 'pt-1')} data-commish-changed>
          {COMMISH_CHANGED_BADGE}
        </Link>
      )}

      {lineup.refusal && (
        <div role="alert" className={cn('flex flex-col gap-2 rounded-[14px] bg-m-gr px-3 py-2.5', variant === 'tab' ? 'mx-3 mb-2' : 'my-2')} data-lineup-refusal>
          <p className="text-[13px] font-medium text-m-tr">{lineup.refusal}</p>
          <p className="text-[12px] font-medium text-m-t3">Nothing changed — the lineup shown is the one that’s saved.</p>
          <div className="flex flex-wrap gap-2">
            {isCommish && !overrideMode && (
              <button
                type="button"
                onClick={() => {
                  lineup.dismissRefusal()
                  onOverrideMode(true)
                }}
                className="h-8 rounded-pill bg-accent px-3 text-[13px] font-semibold text-white"
              >
                Turn on override mode
              </button>
            )}
            <button type="button" onClick={lineup.dismissRefusal} className="h-8 rounded-pill bg-m-b0 px-3 text-[13px] font-semibold text-m-t1">
              Dismiss
            </button>
          </div>
        </div>
      )}

      {model.orphaned.length > 0 && (
        <p role="alert" className={cn('rounded-[14px] bg-m-gr px-3 py-2 text-[12px] font-medium text-m-tr', variant === 'tab' ? 'mx-3 mb-2' : 'my-2')}>
          {model.orphaned.length === 1 ? 'A saved seat names a player' : `${model.orphaned.length} saved seats name players`} no longer on this roster — the seat reads empty; the next move clears it.
        </p>
      )}

      <div className={variant === 'tab' ? 'px-3 pb-5' : ''}>
        {model.starters.map((row) => {
          const sel: SwapSelection = { kind: 'slot', key: row.slot.key }
          const keptId = !row.player ? kept.get(row.slot.key) : undefined
          return (
            <Row
              key={row.slot.key}
              slot={row.slot}
              player={row.player}
              keptName={keptId ? (keptName(keptId) ?? 'A dropped player') : null}
              stats={stats}
              locked={row.player ? locked.has(row.player.player_id) : Boolean(keptId)}
              ring={ringOn(sel)}
              onChip={chipFor(sel)}
              onText={textFor(row.player, sel)}
              chipLabel={chipLabel(row.slot, row.player)}
            />
          )
        })}

        <h2 className={cn('text-[17px] font-semibold tracking-[-0.01em]', variant === 'tab' ? 'px-1 pb-1 pt-[18px]' : 'mt-5')}>Bench</h2>
        {model.bench.map((player) => {
          const sel: SwapSelection = { kind: 'bench', playerId: player.player_id }
          return (
            <Row
              key={player.player_id}
              slot={null}
              player={player}
              stats={stats}
              locked={locked.has(player.player_id)}
              ring={ringOn(sel)}
              onChip={chipFor(sel)}
              onText={textFor(player, sel)}
              chipLabel={chipLabel(null, player)}
            />
          )
        })}
        {Array.from({ length: benchSeats }, (_, i) => {
          const sel: SwapSelection = { kind: 'bench-empty', index: i }
          return (
            <Row
              key={`empty-${i}`}
              slot={null}
              player={null}
              stats={stats}
              locked={false}
              ring={ringOn(sel)}
              onChip={chipFor(sel)}
              onText={textFor(null, sel)}
              chipLabel={chipLabel(null, null)}
            />
          )
        })}
        {model.bench.length === 0 && benchSeats === 0 && (
          <p className="px-1 py-[10px] text-[13px] font-medium text-m-t3">Every rostered player is in the lineup.</p>
        )}

        {model.ir.length > 0 && (
          <>
            <h2 className={cn('text-[17px] font-semibold tracking-[-0.01em]', variant === 'tab' ? 'px-1 pb-1 pt-[18px]' : 'mt-5')}>Reserve</h2>
            {model.ir.map((row) => {
              const sel: SwapSelection = { kind: 'slot', key: row.slot.key }
              return (
                <Row
                  key={row.slot.key}
                  slot={row.slot}
                  player={row.player}
                  stats={stats}
                  locked={row.player ? locked.has(row.player.player_id) : false}
                  ring={ringOn(sel)}
                  onChip={chipFor(sel)}
                  onText={textFor(row.player, sel)}
                  chipLabel={chipLabel(row.slot, row.player)}
                />
              )
            })}
          </>
        )}
      </div>

      <SwapSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        options={options}
        stats={stats}
        onPick={pick}
        drop={dropAction}
      />
      {drop && <DropSheet leagueId={leagueId} teamId={teamId} player={dropping} onClose={() => setDropping(null)} />}
    </div>
  )
}

function WeekArrow({ dir, week, disabled, onWeek }: { dir: 'prev' | 'next'; week: number | null; disabled: boolean; onWeek: (w: number) => void }) {
  return (
    <button
      type="button"
      disabled={week === null || disabled}
      onClick={() => week !== null && onWeek(week)}
      aria-label={dir === 'prev' ? 'Previous week' : 'Next week'}
      className="flex size-[30px] items-center justify-center rounded-full text-accent active:bg-m-b2 disabled:opacity-30"
    >
      <MIcon name={dir === 'prev' ? 'back' : 'chevronRight'} size={12} stroke={2.2} />
    </button>
  )
}
