'use client'

import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { useEffect, useMemo, useRef, useState } from 'react'

import { PositionBadge } from '@/components/players/position-badge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Icon } from '@/components/ui/icon'
import { Input } from '@/components/ui/input'
import { useSetLineup, type TeamLineupRow } from '@/hooks/use-lineup'
import type { RosterPlayer } from '@/lib/leagues/api/rosters-service'
import type { RosterSettings } from '@/lib/leagues/settings/league-settings'
import { cn } from '@/lib/utils'

import { formatInstantInZone } from './league-home-states-ops'
import {
  buildEditorModel,
  irStintChip,
  lockBadgeFor,
  lockedPlayerIds,
  placementFromStored,
  placementsEqual,
  planMove,
  positionMatches,
  saveOutcomeCopy,
  slotInstances,
  starterFlagChips,
  starterHint,
  startersByKey,
  type HintTone,
  type MoveTarget,
  type Placement,

  type SlotRow,
  type WeekEditability,
} from './lineup-editor-ops'

/**
 * LineupEditor (§16.2 `lineup-editor`; §11.2; §16.5.2 Weekly loop; §16.5.4
 * locked 🔒 · DL stint · bye/OUT flags — M4 task L.D5.1; PROGRESS D293,
 * D315, D316).
 *
 * Slot-based starters / bench / IR over the league's `roster_settings`,
 * edited as a `slot_map` placement (§12.13) and submitted WHOLE — IR keys
 * included — through `useSetLineup` (F224(e)). The decisions live in
 * `lineup-editor-ops.ts`; this file is the interaction and the paint.
 *
 * **Never optimistic (§11.2 / D293 / D315(8)).** The placement the manager
 * arranges is a DRAFT until `set_lineup` answers; what renders after a save
 * is the server's canonical map (`rearranged` + `moved[]` named), a
 * refusal renders the RPC's own words (the lock refusal names the player
 * and his kickoff — verbatim, never re-worded), and `no_changes` is its
 * own state (R779). A refusal also RE-READS the roster and the row
 * (`useSetLineup`'s `onError`, R822(i)): the view this client evaluated was
 * the stale one, so the 🔒 the server just enforced reaches the screen
 * without a reload — the draft is kept (it is the manager's), the seat it
 * put him in now reads locked, and Discard is the way back.
 *
 * **The 🔒 is the fetched evaluation.** `game_lock` (the pool VIEW the tick
 * refreshes from `nfl_games` — D315(5)) decides which rows are read-only;
 * `locked_at` and `starters[].kickoff_at` are shown as records ("locks
 * from", "kickoff") and decide nothing (R779; the ops header). A locked
 * row is not draggable and every client-side move plan refuses it by name
 * — and the server is still the decider when the two disagree.
 *
 * **Drag (§16: "must work on touch — reuse @dnd-kit").** `@dnd-kit/core`'s
 * draggable/droppable pair, not `@dnd-kit/sortable`: this is a SLOT model
 * (a player drops INTO a keyed seat, displacing its occupant) — neither the
 * list-reorder `useSortable` of `my-queue.tsx` nor the drop-gap list model
 * of `lists/v2/use-list-drag.tsx` fits, and forking either would carry
 * their list semantics into a grid that has none. Sensors are the
 * `use-list-drag` pair (mouse after 6px, touch after a 220ms press so a
 * finger scroll stays a scroll). Every drag has a tap twin: select a
 * player, tap a seat — the keyboard/assistive path costs no second
 * mechanism.
 *
 * Elevation: nothing here rests elevated (CLAUDE.md). The one shadow is the
 * `DragOverlay` ghost — a true overlay floating over the page.
 */

export interface LineupEditorProps {
  leagueId: string
  teamId: string
  week: number
  settings: RosterSettings
  allowIllegal: boolean
  roster: readonly RosterPlayer[]
  /** The stored row for the week, or null (nothing set yet — D293/D313). */
  stored: TeamLineupRow | null
  currentWeek: number | null
  editability: WeekEditability
  /** The viewer may submit for this team (its manager, or the commissioner
   *  — who must give a reason, D290/R738). */
  canEdit: boolean
  isCommissionerArm: boolean
  /** The league's named zone (`settings.draft.time_zone`) for the §16.4
   *  hover; null renders viewer-local only. */
  leagueTimeZone: string | null
}

type Notice = { tone: HintTone | 'positive'; text: string }

export function LineupEditor({
  leagueId,
  teamId,
  week,
  settings,
  allowIllegal,
  roster,
  stored,
  currentWeek,
  editability,
  canEdit,
  isCommissionerArm,
  leagueTimeZone,
}: LineupEditorProps) {
  const slots = useMemo(() => slotInstances(settings), [settings])
  const players = useMemo(() => new Map(roster.map((p) => [p.player_id, p])), [roster])
  const weekIsCurrent = currentWeek !== null && week === currentWeek
  const locked = useMemo(() => lockedPlayerIds(roster, weekIsCurrent), [roster, weekIsCurrent])
  const storedPlacement = useMemo(() => placementFromStored(stored?.slot_map, roster), [stored, roster])
  const storedStarters = useMemo(() => startersByKey(stored?.starters), [stored])

  // The DRAFT placement — reset to the stored row whenever the stored row
  // changes underneath an UNEDITED draft (a refetch after a save, the
  // tick's re-stamp, another tab's set); an edited draft is kept.
  const [draft, setDraft] = useState<Placement>(storedPlacement)
  const baseline = useRef<Placement>(storedPlacement)
  useEffect(() => {
    if (placementsEqual(baseline.current, storedPlacement)) return
    const wasClean = placementsEqual(draft, baseline.current)
    baseline.current = storedPlacement
    if (wasClean) setDraft(storedPlacement)
  }, [storedPlacement, draft])

  const [selected, setSelected] = useState<string | null>(null)
  const [dragging, setDragging] = useState<string | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [reason, setReason] = useState('')

  const mutation = useSetLineup(leagueId, teamId)
  const model = useMemo(() => buildEditorModel(draft, roster, settings), [draft, roster, settings])
  // Dirty against the BASELINE, not the stored prop: after a successful save
  // the baseline is the server's canonical map while `storedPlacement` is
  // still the pre-save row until the refetch lands (R826).
  const dirty = !placementsEqual(draft, baseline.current)
  const readOnly = !canEdit || editability.state !== 'open'

  const ctx = useMemo(() => ({ slots, players, locked, currentWeek }), [slots, players, locked, currentWeek])

  function move(playerId: string, target: MoveTarget) {
    if (readOnly) return
    const plan = planMove(draft, playerId, target, ctx)
    if (!plan.ok) {
      if (plan.reason !== 'noop') setNotice({ tone: 'negative', text: plan.message })
      setSelected(null)
      return
    }
    setNotice(null)
    setDraft(plan.next)
    setSelected(null)
    mutation.reset()
  }

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 6 } }),
  )

  function onDragStart(e: DragStartEvent) {
    setDragging(String(e.active.id))
    setSelected(null)
  }
  function onDragEnd(e: DragEndEvent) {
    const playerId = String(e.active.id)
    setDragging(null)
    const over = e.over ? String(e.over.id) : null
    if (!over) return
    if (over === 'bench') move(playerId, { kind: 'bench' })
    else if (over.startsWith('slot:')) move(playerId, { kind: 'slot', key: over.slice(5) })
  }

  function save() {
    if (readOnly || !dirty) return
    setNotice(null)
    mutation.submit({
      week,
      slotMap: draft,
      ...(isCommissionerArm ? { reason: reason.trim() || null } : {}),
    })
  }
  function discard() {
    setDraft(baseline.current)
    setSelected(null)
    setNotice(null)
    mutation.reset()
  }

  // After a SUCCESSFUL save, render the server's canonical map immediately
  // (the refetch then lands the same row and the baseline follows).
  const lastResultId = useRef<string | null>(null)
  useEffect(() => {
    const result = mutation.data
    if (!result || lastResultId.current === result.action_id) return
    lastResultId.current = result.action_id
    const canonical = placementFromStored(result.slot_map, roster)
    baseline.current = canonical
    setDraft(canonical)
  }, [mutation.data, roster])

  const nameOf = (id: string) => players.get(id)?.full_name ?? id
  const labelOf = (key: string) => slots.find((s) => s.key === key)?.label ?? key
  const selectedPlayer = selected ? players.get(selected) ?? null : null

  const outcome = mutation.data ? saveOutcomeCopy(mutation.data, nameOf, labelOf) : null
  const refusal = mutation.error ? mutation.error.message : null

  const draggingPlayer = dragging ? players.get(dragging) ?? null : null

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
      <div className="flex flex-col gap-4" data-lineup-editor={teamId}>
        {editability.state === 'closed' && (
          <p role="status" className="rounded-sm border border-ink bg-n-4 px-3 py-2 text-[12px] font-semibold text-ink">
            {editability.reason}
          </p>
        )}
        {editability.state === 'unknown' && (
          <p role="status" className="rounded-sm border border-ink bg-caution-soft px-3 py-2 text-[12px] font-semibold text-ink">
            This league has no schedule yet — the week ladder decides which week is current, so edits wait for it.
          </p>
        )}
        {!canEdit && editability.state === 'open' && (
          <p role="status" className="rounded-sm border border-ink bg-white px-3 py-2 text-[12px] font-semibold text-n-3">
            Viewing — only this team’s manager (or the commissioner) can set its lineup.
          </p>
        )}
        {model.orphaned.length > 0 && (
          <p role="alert" className="rounded-sm border border-negative bg-negative-soft px-3 py-2 text-[12px] font-semibold text-ink">
            {model.orphaned.length} stored {model.orphaned.length === 1 ? 'placement names a player' : 'placements name players'} no longer on this roster
            ({model.orphaned.map((o) => `${labelOf(o.key)}: ${o.player_id}`).join(', ')}) — the seat reads empty here; saving clears it.
          </p>
        )}

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.4fr_1fr]">
          <Card>
            <CardHeader>
              <CardTitle>Starters</CardTitle>
              <span className="fs-overline text-[9px] text-n-3">
                Week <span className="fs-num">{week}</span>
                {selectedPlayer && !readOnly ? ` · tap a seat for ${selectedPlayer.full_name}` : ''}
              </span>
            </CardHeader>
            <CardContent className="flex flex-col gap-1.5 p-3">
              {model.starters.map((row) => (
                <SlotSeat
                  key={row.slot.key}
                  row={row}
                  week={week}
                  allowIllegal={allowIllegal}
                  currentWeek={currentWeek}
                  weekIsCurrent={weekIsCurrent}
                  storedStarter={storedStarters.get(row.slot.key) ?? null}
                  leagueTimeZone={leagueTimeZone}
                  readOnly={readOnly}
                  locked={row.player ? locked.has(row.player.player_id) : false}
                  selected={selected}
                  acceptsSelected={Boolean(selectedPlayer && positionMatches(selectedPlayer.position, row.slot.eligible))}
                  onSeat={() => selected && move(selected, { kind: 'slot', key: row.slot.key })}
                  onSelect={(id) => setSelected((cur) => (cur === id ? null : id))}
                  onBench={(id) => move(id, { kind: 'bench' })}
                />
              ))}
              {model.ir.length > 0 && (
                <>
                  <p className="fs-overline mt-2 text-[9px] text-n-3">Injured reserve</p>
                  {model.ir.map((row) => (
                    <SlotSeat
                      key={row.slot.key}
                      row={row}
                      week={week}
                      allowIllegal={allowIllegal}
                      currentWeek={currentWeek}
                      weekIsCurrent={weekIsCurrent}
                      storedStarter={null}
                      leagueTimeZone={leagueTimeZone}
                      readOnly={readOnly}
                      locked={row.player ? locked.has(row.player.player_id) : false}
                      selected={selected}
                      acceptsSelected={Boolean(selectedPlayer)}
                      onSeat={() => selected && move(selected, { kind: 'slot', key: row.slot.key })}
                      onSelect={(id) => setSelected((cur) => (cur === id ? null : id))}
                      onBench={(id) => move(id, { kind: 'bench' })}
                    />
                  ))}
                </>
              )}
            </CardContent>
          </Card>

          <BenchZone
            bench={model.bench}
            locked={locked}
            weekIsCurrent={weekIsCurrent}
            currentWeek={currentWeek}
            readOnly={readOnly}
            selected={selected}
            onSelect={(id) => setSelected((cur) => (cur === id ? null : id))}
            onDropSelected={() => selected && move(selected, { kind: 'bench' })}
            empty={roster.length === 0}
          />
        </div>

        {/* Notices — one at a time, the newest wins. The server's refusal is
            rendered VERBATIM (F224(e)); a client-side plan refusal is the
            editor's own copy, before any submit. */}
        {refusal && (
          <div role="alert" className="flex flex-col gap-2 rounded-sm border border-negative bg-negative-soft px-3 py-2 text-[12px] font-semibold text-ink">
            <span>{refusal}</span>
            <div className="flex gap-2">
              <Button variant="stroke" size="sm" onClick={() => mutation.reset()}>
                Dismiss
              </Button>
            </div>
          </div>
        )}
        {!refusal && notice && <NoticeLine tone={notice.tone} text={notice.text} />}
        {!refusal && !notice && outcome && <NoticeLine tone="positive" text={outcome} />}

        {!readOnly && (
          <div className="flex flex-wrap items-center gap-2.5">
            {isCommissionerArm && (
              <label className="flex min-w-[240px] flex-1 flex-col gap-1 text-[11px] font-bold text-ink">
                Reason (required — you are setting another team’s lineup; it posts to league chat)
                <Input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  maxLength={500}
                  className="h-btn-md px-2 text-[12px]"
                  placeholder="e.g. manager away — set per his message"
                />
              </label>
            )}
            <Button
              variant="blue"
              size="md"
              disabled={!dirty || mutation.isPending || (isCommissionerArm && reason.trim().length === 0)}
              onClick={save}
            >
              <Icon name="save" size={13} />
              {mutation.isPending ? 'Saving…' : 'Save lineup'}
            </Button>
            <Button variant="stroke" size="md" disabled={!dirty || mutation.isPending} onClick={discard}>
              Discard changes
            </Button>
            {dirty && !mutation.isPending && (
              <span className="text-[11px] font-medium text-n-3">Unsaved — the server confirms every placement.</span>
            )}
          </div>
        )}
      </div>

      {/* The drag ghost — a TRUE overlay floating above the page, so it
          rests elevated by definition (CLAUDE.md's overlay exception). */}
      <DragOverlay dropAnimation={null}>
        {draggingPlayer ? (
          <div className="flex items-center gap-1.5 rounded-sm border border-ink bg-white px-2 py-1 text-[11px] font-bold shadow-hard-4">
            <PositionBadge position={draggingPlayer.position} size="sm" />
            <span>{draggingPlayer.full_name}</span>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}

// ---------------------------------------------------------------------------
// Seats and rows
// ---------------------------------------------------------------------------

function NoticeLine({ tone, text }: { tone: HintTone | 'positive'; text: string }) {
  return (
    <p
      role="status"
      className={cn(
        'rounded-sm border px-3 py-2 text-[12px] font-semibold text-ink',
        tone === 'positive' && 'border-positive bg-positive-soft',
        tone === 'caution' && 'border-ink bg-caution-soft',
        tone === 'negative' && 'border-negative bg-negative-soft',
      )}
    >
      {text}
    </p>
  )
}

interface SlotSeatProps {
  row: SlotRow
  week: number
  allowIllegal: boolean
  currentWeek: number | null
  weekIsCurrent: boolean
  storedStarter: { kickoff_at: string | null; flags: string[]; player_id: string | null } | null
  leagueTimeZone: string | null
  readOnly: boolean
  locked: boolean
  selected: string | null
  acceptsSelected: boolean
  onSeat: () => void
  onSelect: (id: string) => void
  onBench: (id: string) => void
}

function SlotSeat({
  row,
  week,
  allowIllegal,
  currentWeek,
  weekIsCurrent,
  storedStarter,
  leagueTimeZone,
  readOnly,
  locked,
  selected,
  acceptsSelected,
  onSeat,
  onSelect,
  onBench,
}: SlotSeatProps) {
  const { slot, player } = row
  const droppable = useDroppable({ id: `slot:${slot.key}`, disabled: readOnly || locked })
  const target = Boolean(selected) && !readOnly && !locked && acceptsSelected && selected !== player?.player_id
  const hint = player && slot.kind === 'start' ? starterHint(player, week, allowIllegal) : null
  // The server's OWN flags for the stored occupant (only meaningful while
  // the seat still holds him).
  const storedFlags =
    storedStarter && player && storedStarter.player_id === player.player_id
      ? starterFlagChips(storedStarter.flags, allowIllegal)
      : []
  const kickoff = storedStarter && player && storedStarter.player_id === player.player_id ? storedStarter.kickoff_at : null

  return (
    <div
      ref={droppable.setNodeRef}
      data-slot={slot.key}
      className={cn(
        'flex min-h-[38px] items-center gap-2 rounded-sm border px-2 py-1',
        locked ? 'border-ink bg-n-4' : 'border-ink bg-white',
        droppable.isOver && !locked && 'border-accent bg-accent-soft',
        target && 'border-accent',
      )}
    >
      <span className="fs-overline w-12 shrink-0 text-[9px] text-n-3">{slot.label}</span>
      {player ? (
        <PlayerRow
          player={player}
          locked={locked}
          weekIsCurrent={weekIsCurrent}
          currentWeek={currentWeek}
          readOnly={readOnly}
          selected={selected === player.player_id}
          onSelect={() => onSelect(player.player_id)}
          hints={[...(hint ? [hint] : []), ...storedFlags]}
          kickoff={kickoff}
          leagueTimeZone={leagueTimeZone}
          trailing={
            !readOnly && !locked ? (
              <Button variant="ghost" size="icon-sm" aria-label={`Bench ${player.full_name}`} onClick={() => onBench(player.player_id)}>
                <Icon name="close" size={12} />
              </Button>
            ) : null
          }
        />
      ) : (
        <button
          type="button"
          disabled={!target}
          onClick={onSeat}
          className={cn(
            'flex h-[26px] min-w-0 flex-1 items-center rounded-sm border border-dashed px-2 text-left text-[11px] font-medium',
            target ? 'border-accent text-ink hover:bg-accent-soft' : 'border-n-3 text-n-3',
          )}
        >
          {target ? `Seat here` : 'Empty'}
        </button>
      )}
      {target && player && (
        <Button variant="stroke" size="sm" onClick={onSeat} aria-label={`Swap into ${slot.label}`}>
          Swap in
        </Button>
      )}
    </div>
  )
}

interface PlayerRowProps {
  player: RosterPlayer
  locked: boolean
  weekIsCurrent: boolean
  currentWeek: number | null
  readOnly: boolean
  selected: boolean
  onSelect: () => void
  hints: Array<{ tone: HintTone; text: string }>
  kickoff: string | null
  leagueTimeZone: string | null
  trailing?: React.ReactNode
}

function PlayerRow({ player, locked, weekIsCurrent, currentWeek, readOnly, selected, onSelect, hints, kickoff, leagueTimeZone, trailing }: PlayerRowProps) {
  const draggable = useDraggable({ id: player.player_id, disabled: readOnly || locked })
  const lock = lockBadgeFor(player.game_lock, weekIsCurrent)
  const stint = irStintChip(player, currentWeek)
  const kickoffView = kickoff ? formatKickoff(kickoff, leagueTimeZone) : null

  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
      <button
        ref={draggable.setNodeRef}
        type="button"
        {...draggable.attributes}
        {...(readOnly || locked ? {} : draggable.listeners)}
        data-player={player.player_id}
        aria-pressed={selected}
        aria-disabled={readOnly || locked}
        onClick={readOnly || locked ? undefined : onSelect}
        className={cn(
          'flex min-w-[180px] flex-1 items-center gap-1.5 rounded-sm border px-1.5 py-0.5 text-left text-[11px] font-bold',
          readOnly || locked ? 'cursor-default border-transparent' : 'cursor-grab border-transparent hover:border-ink hover:bg-n-4 active:cursor-grabbing',
          selected && 'border-accent bg-accent-soft',
          draggable.isDragging && 'opacity-40',
        )}
      >
        <PositionBadge position={player.position} size="sm" />
        <span className="truncate">{player.full_name}</span>
        <span className="shrink-0 text-[10px] font-medium text-n-3">{player.nfl_team ?? '—'}</span>
        {kickoffView && (
          <span className="fs-num shrink-0 text-[10px] font-medium text-n-3" title={kickoffView.title ?? undefined}>
            {kickoffView.local}
          </span>
        )}
      </button>
      <span className="flex shrink-0 flex-wrap items-center gap-1">
        {lock.locked && (
          <Badge variant="black" title={lock.until ? `Locked until ${formatKickoff(lock.until, leagueTimeZone).local}` : lock.copy}>
            🔒 Locked
          </Badge>
        )}
        {lock.locked && !lock.until && <span className="text-[10px] font-medium text-n-3">{lock.copy}</span>}
        {stint && <Badge variant="stroke-purple">{stint}</Badge>}
        {hints.map((h) => (
          <Badge key={h.text} variant={h.tone === 'negative' ? 'stroke-pink' : 'yellow'}>
            {h.text}
          </Badge>
        ))}
      </span>
      {trailing}
    </div>
  )
}

interface BenchZoneProps {
  bench: RosterPlayer[]
  locked: ReadonlySet<string>
  weekIsCurrent: boolean
  currentWeek: number | null
  readOnly: boolean
  selected: string | null
  onSelect: (id: string) => void
  onDropSelected: () => void
  empty: boolean
}

function BenchZone({ bench, locked, weekIsCurrent, currentWeek, readOnly, selected, onSelect, onDropSelected, empty }: BenchZoneProps) {
  const droppable = useDroppable({ id: 'bench', disabled: readOnly })
  const selectedIsStarter = Boolean(selected) && !bench.some((p) => p.player_id === selected)
  return (
    <Card ref={droppable.setNodeRef} className={cn(droppable.isOver && 'border-accent')} data-bench>
      <CardHeader>
        <CardTitle>Bench</CardTitle>
        <span className="fs-overline text-[9px] text-n-3">
          <span className="fs-num">{bench.length}</span> {bench.length === 1 ? 'player' : 'players'}
        </span>
      </CardHeader>
      <CardContent className="flex flex-col gap-1.5 p-3">
        {empty ? (
          <p className="text-[12px] font-medium text-n-3">
            No players on this roster yet — the draft (or a free-agent add) fills it.
          </p>
        ) : bench.length === 0 ? (
          <p className="text-[12px] font-medium text-n-3">Every rostered player is seated.</p>
        ) : (
          bench.map((player) => (
            <div key={player.player_id} className={cn('flex min-h-[34px] items-center rounded-sm border px-2 py-1', locked.has(player.player_id) ? 'border-ink bg-n-4' : 'border-ink bg-white')}>
              <PlayerRow
                player={player}
                locked={locked.has(player.player_id)}
                weekIsCurrent={weekIsCurrent}
                currentWeek={currentWeek}
                readOnly={readOnly}
                selected={selected === player.player_id}
                onSelect={() => onSelect(player.player_id)}
                hints={[]}
                kickoff={null}
                leagueTimeZone={null}
              />
            </div>
          ))
        )}
        {selectedIsStarter && !readOnly && (
          <Button variant="stroke" size="sm" onClick={onDropSelected}>
            Move the selected starter to the bench
          </Button>
        )}
      </CardContent>
    </Card>
  )
}

/** §16.4: viewer-local, league zone on hover. Formatting a STORED instant —
 *  no clock is read. */
export function formatKickoff(iso: string, leagueTimeZone: string | null): { local: string; title: string | null } {
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return { local: iso, title: null }
  const local = new Intl.DateTimeFormat(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(ms))
  const zoned = leagueTimeZone ? formatInstantInZone(ms, leagueTimeZone) : null
  return { local, title: zoned ? `${zoned.text}${zoned.zoneAbbrev ? ` ${zoned.zoneAbbrev}` : ''} (league time)` : null }
}
