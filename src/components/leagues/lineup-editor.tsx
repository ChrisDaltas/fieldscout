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
import { useCommishEditLineup } from '@/hooks/use-commish-lineup'
import { useSetLineup, type TeamLineupRow } from '@/hooks/use-lineup'
import type { RosterPlayer } from '@/lib/leagues/api/rosters-service'
import type { RosterSettings } from '@/lib/leagues/settings/league-settings'
import { cn } from '@/lib/utils'

import {
  buildEditorModel,
  formatKickoff,
  irStintChip,
  lineupSaveRequest,
  lockBadgeFor,
  lockedPlayerIds,
  overrideExitCopy,
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
import { OverrideModeBar } from './override-mode-bar'

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
 * **COMMISSIONER OVERRIDE MODE IS A MODE (M6A; PROGRESS §3(h), ruled by
 * Chris 2026-09-11 after using the shipped flow on four teams).** *"the
 * commissioner going into 'override mode' which lets them act like any GM in
 * the league, and then when they're done they exit override mode. when
 * override mode is active there is some visual indications that it's on."*
 *
 * So: ONE deliberate switch, offered to a commissioner in every week state
 * (never behind a refusal, never behind `state === 'closed'`); it stays on
 * across saves and across team pages until he turns it off (the state lives in
 * `commish-override-store.ts`, keyed by league); while it is on the editor is
 * framed and banner-marked so the mode is unmistakable; and **he is never
 * asked for a reason** — *"yeah i think no reason at all is fine … if anyone
 * cares they can ask"*, which supersedes §(h)'s "captured once" clause. The
 * client sends a fixed label (`lineup-editor-ops.ts`'s
 * `COMMISSIONER_OVERRIDE_REASON`) because the RPC RAISEs on a blank; the
 * receipt is the audit row, not the sentence.
 *
 * What the shipped version did instead — offer the override only AFTER a
 * refusal, then disable Save behind an unmentioned Reason field — cost Chris
 * two of the four teams he tried to fix: `set_lineup` refusals at 15:10:47 and
 * 15:12:01 with ZERO `commissioner_actions` rows behind them. A disabled
 * control with no stated precondition is CLAUDE.md's "never let 'nothing
 * happened' mean 'it worked'" wearing a button.
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
   *  — whose save carries the §15.4 label, never a prompted reason). */
  canEdit: boolean
  isCommissionerArm: boolean
  /** The viewer holds the commissioner role in THIS league. Distinct from
   *  `isCommissionerArm`, which only means "acting for a team that is not
   *  mine": a commissioner fixing HIS OWN team after kickoff needs the
   *  audited override too (PROGRESS §3(a) — any action, on any team). */
  isCommish: boolean
  /** The league's named zone (`settings.draft.time_zone`) for the §16.4
   *  hover; null renders viewer-local only. */
  leagueTimeZone: string | null
  /** COMMISSIONER OVERRIDE MODE, owned by the page (and under it by
   *  `commish-override-store`, so the mode survives navigating from team 5 to
   *  team 6). Lifted out of this component deliberately: it is a mode of the
   *  commissioner's session, not of one mount, and being a prop is what lets
   *  both of its states be rendered in a pin. */
  overrideMode: boolean
  onOverrideMode: (next: boolean) => void
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
  isCommish,
  leagueTimeZone,
  overrideMode,
  onOverrideMode,
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
  // NO REASON STATE, AND NO REASON INPUT — anywhere. Chris, 2026-09-11:
  // *"yeah i think no reason at all is fine"* … *"if anyone cares they can
  // ask"*. Both verbs that RAISE on a blank reason are fed a fixed label from
  // `lineupSaveRequest`. Re-adding a text field here re-adds the defect.

  const mutation = useSetLineup(leagueId, teamId)
  const override = useCommishEditLineup(leagueId)
  const active = overrideMode ? override : mutation
  const model = useMemo(() => buildEditorModel(draft, roster, settings), [draft, roster, settings])
  // Dirty against the BASELINE, not the stored prop: after a successful save
  // the baseline is the server's canonical map while `storedPlacement` is
  // still the pre-save row until the refetch lands (R826).
  const dirty = !placementsEqual(draft, baseline.current)
  // In override mode the week gates do not apply — the audited verb lifts the
  // past-week and closed-week refusals, so a commissioner who has entered
  // override mode may still edit a week the manager's editor calls closed.
  const readOnly = !canEdit || (editability.state !== 'open' && !overrideMode)

  // `lockExempt` relaxes planMove's two lock arms. The FOUR sites move
  // together — planMove (both arms), useDraggable, useDroppable and the
  // bench control — or a player becomes draggable but undroppable.
  const lockExempt = overrideMode
  const ctx = useMemo(
    () => ({ slots, players, locked, currentWeek, lockExempt }),
    [slots, players, locked, currentWeek, lockExempt],
  )

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
    override.reset()
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

  // ONE action. No second field, no second press, and the SECOND save of a
  // session is byte-identical to the first — `lineupSaveRequest` is pure and
  // reads nothing the commissioner has to type.
  function save() {
    if (readOnly || !dirty) return
    setNotice(null)
    const request = lineupSaveRequest({ overrideMode, isCommissionerArm, slotMap: draft })
    if (request.verb === 'commish_edit_lineup') {
      // Clear the OTHER mutation first: `settled` and `refusal` read both
      // hooks, and a stale success from the manager's verb would otherwise
      // shadow this one's outcome for the whole session (the mode now outlives
      // a save, so both hooks really can hold results at once).
      mutation.reset()
      override.submit({ teamId, week, slotMap: request.slotMap, reason: request.reason })
      return
    }
    override.reset()
    mutation.submit({ week, slotMap: request.slotMap, reason: request.reason })
  }
  /** Discard the PLACEMENTS. It does not leave override mode — the mode has
   *  its own exit, and conflating the two is how the shipped version dropped
   *  him out of it without saying so. */
  function discard() {
    setDraft(baseline.current)
    setSelected(null)
    setNotice(null)
    mutation.reset()
    override.reset()
  }
  /**
   * Leave the mode. **The draft is never touched** — his placements are his,
   * and silently discarding them is the exact bug class this feature exists to
   * end. What DOES change is what they are allowed to be, so that is said out
   * loud instead of waiting to surface as a refusal.
   */
  function exitOverrideMode() {
    setSelected(null)
    setNotice({ tone: dirty ? 'caution' : 'positive', text: overrideExitCopy(dirty) })
    onOverrideMode(false)
  }

  // After a SUCCESSFUL save, render the server's canonical map immediately
  // (the refetch then lands the same row and the baseline follows).
  const lastResultId = useRef<string | null>(null)
  const settled = mutation.data ?? override.data ?? null
  useEffect(() => {
    if (!settled || lastResultId.current === settled.action_id) return
    lastResultId.current = settled.action_id
    const canonical = placementFromStored(settled.slot_map, roster)
    baseline.current = canonical
    setDraft(canonical)
    // THE MODE SURVIVES THE SAVE. It used to be spent by one — which made
    // every subsequent fix a fresh trip through the door, i.e. the
    // per-transaction shape Chris rejected. He turns it off when he is done.
  }, [settled, roster])

  const nameOf = (id: string) => players.get(id)?.full_name ?? id
  const labelOf = (key: string) => slots.find((s) => s.key === key)?.label ?? key
  const selectedPlayer = selected ? players.get(selected) ?? null : null

  const outcome = settled ? saveOutcomeCopy(settled, nameOf, labelOf) : null
  const refusal = (mutation.error ?? override.error)?.message ?? null
  // THE SHORTCUT INTO THE MODE — kept, deliberately, even though the mode's
  // own switch is now persistent and unconditional above. The ruling makes the
  // switch the way IN; it does not make a refusal a dead end, and a dead end is
  // worse than what shipped. A refusal is the one moment the intact draft and
  // the server's own words are on screen together, so the way out is offered
  // right there rather than sending him up the page to find it. It enters the
  // SAME mode — same state, same banner, same exit — so there is no second
  // path to maintain, and it is not filtered by the refusal's WORDS (the old
  // matcher read three substrings of migration 114's prose that nothing pins,
  // so a reworded refusal would have silently removed the button).
  const canOfferOverride = isCommish && !overrideMode

  const draggingPlayer = dragging ? players.get(dragging) ?? null : null

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
      {/* THE FRAME. While the mode is on the WHOLE editor is wrapped in a lime
          "look here" surround (the palette's live-signal role — never a
          control, and pointedly not `negative`, because this is a power in use,
          not an error). Two tokens, no arbitrary values, no shadow: elevation
          is a hover state and this is a resting condition, so it is carried by
          fill + border exactly as CLAUDE.md requires. */}
      <div
        className={cn(
          'flex flex-col gap-4',
          overrideMode && 'rounded-sm border-2 border-brand-strong bg-brand-soft p-2 sm:p-3',
        )}
        data-lineup-editor={teamId}
        data-override-mode={overrideMode ? 'on' : 'off'}
      >
        {/* THE SWITCH — first child, so it is on screen before anything has to
            be scrolled, and present in EVERY week state: not behind a refusal,
            not behind `state === 'closed'`. One control, commissioner only; the
            manager's editor is byte-identical to before (`isCommish` is false
            for him, so this whole subtree is absent). */}
        {isCommish && canEdit && (
          // R985: the toggle is LOCKED while a save is in flight. Without
          // this, exiting mid-save flips `active` to the other hook, so the
          // pending write loses its "Saving…" line and its success notice is
          // swallowed by the exit message — the screen then says the
          // placements are unsaved while the save actually succeeded. On an
          // open week it also re-enables Save as the MANAGER verb, inviting
          // a second concurrent write against the same draft.
          // R986: entering clears any stale exit notice, which otherwise
          // sits on screen contradicting the ON state.
          // The control itself is `OverrideModeBar` — ONE switch, shared with
          // the matchup page since M6A L.E1.12.
          <OverrideModeBar
            on={overrideMode}
            busy={active.isPending}
            onToggle={(next) => {
              if (next) {
                setNotice(null)
                onOverrideMode(true)
              } else {
                exitOverrideMode()
              }
            }}
          >
            {overrideMode
              ? 'You are acting as this team’s GM. Locked players move, closed weeks open, and every save is recorded — who changed what, when. Exit when you’re done.'
              : 'Commissioner — override mode lets you act as any team’s GM: edit after kickoff, or for a week that has closed. It stays on until you turn it off, and every save is recorded.'}
          </OverrideModeBar>
        )}
        {editability.state === 'closed' && !overrideMode && (
          <div role="status" className="flex flex-col gap-2 rounded-sm border border-ink bg-n-4 px-3 py-2 text-[12px] font-semibold text-ink">
            <span>{editability.reason}</span>
          </div>
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
                  lockExempt={lockExempt}
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
                      lockExempt={lockExempt}
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
            lockExempt={lockExempt}
            selected={selected}
            onSelect={(id) => setSelected((cur) => (cur === id ? null : id))}
            onDropSelected={() => selected && move(selected, { kind: 'bench' })}
            empty={roster.length === 0}
          />
        </div>

        {/* Notices — one at a time, the newest wins. The server's refusal is
            rendered VERBATIM (F224(e)); a client-side plan refusal is the
            editor's own copy, before any submit. */}
        {/* The refusal is the ONE moment the intact draft and the server's
            reason are on screen together, so the way into the mode is repeated
            HERE — it turns on the same mode the switch above does, keeping the
            SAME placements rather than asking him to rebuild them. */}
        {refusal && (
          <div role="alert" className="flex flex-col gap-2 rounded-sm border border-negative bg-negative-soft px-3 py-2 text-[12px] font-semibold text-ink">
            <span>{refusal}</span>
            <div className="flex flex-wrap gap-2">
              {canOfferOverride && (
                <Button
                  variant="blue"
                  size="sm"
                  onClick={() => {
                    mutation.reset()
                    onOverrideMode(true)
                  }}
                  data-offer-override
                >
                  Turn on override mode
                </Button>
              )}
              <Button
                variant="stroke"
                size="sm"
                onClick={() => {
                  mutation.reset()
                  override.reset()
                }}
              >
                Dismiss
              </Button>
            </div>
            {canOfferOverride && (
              <span className="text-[11px] font-medium text-ink">
                Your placements are still here — nothing was lost. Override mode keeps them, lifts this refusal, and stays on until you exit it.
              </span>
            )}
          </div>
        )}
        {!refusal && notice && <NoticeLine tone={notice.tone} text={notice.text} />}
        {/* A save whose SCORE did not follow is not a positive outcome — the
            copy says so and the tone matches it (R971). */}
        {!refusal && !notice && outcome && (
          <NoticeLine tone={settled && 'score_stale' in settled && settled.score_stale === true ? 'caution' : 'positive'} text={outcome} />
        )}

        {!readOnly && (
          <div className="flex flex-wrap items-center gap-2.5">
            {/* L.D6.2: the two commit controls carry stable hooks. Their only
                other handle is their own label, and the label changes while
                submitting ("Saving…"), so a browser spec would have to select
                on prose that moves — the R399 vacuity lesson.

                NO REASON FIELD, in either path. The button is disabled for
                exactly two reasons and BOTH are named on screen below it —
                nothing to save, or a save in flight. That is the whole of the
                fix: the shipped version sat disabled behind an unmentioned
                Reason field and said nothing at all. */}
            <Button
              variant="blue"
              size="md"
              disabled={!dirty || active.isPending}
              onClick={save}
              data-save-lineup
            >
              <Icon name="save" size={13} />
              {active.isPending ? 'Saving…' : overrideMode ? 'Save override' : 'Save lineup'}
            </Button>
            <Button variant="stroke" size="md" disabled={!dirty || active.isPending} onClick={discard} data-discard-lineup>
              Discard changes
            </Button>
            {/* Every disabled state of those two says WHY, right here. */}
            <span className="text-[11px] font-medium text-n-3" data-save-hint>
              {active.isPending
                ? 'Saving — the server confirms every placement.'
                : dirty
                  ? overrideMode
                    ? 'Unsaved — saving records a commissioner override: who changed what, and when.'
                    : 'Unsaved — the server confirms every placement.'
                  : 'Nothing to save — this lineup already matches what’s stored. Move a player to enable Save.'}
            </span>
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
  /** Commissioner override mode: the 🔒 badge stays, the wall comes down. */
  lockExempt?: boolean
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
  lockExempt,
  selected,
  acceptsSelected,
  onSeat,
  onSelect,
  onBench,
}: SlotSeatProps) {
  const { slot, player } = row
  // In override mode the 🔒 badge STAYS (it is the record of what is being
  // overridden) but stops being a wall — this and the three other lock sites
  // relax together, or a player becomes draggable but undroppable.
  const frozen = locked && !lockExempt
  const droppable = useDroppable({ id: `slot:${slot.key}`, disabled: readOnly || frozen })
  const target = Boolean(selected) && !readOnly && !frozen && acceptsSelected && selected !== player?.player_id
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
        droppable.isOver && !frozen && 'border-accent bg-accent-soft',
        target && 'border-accent',
      )}
    >
      <span className="fs-overline w-12 shrink-0 text-[9px] text-n-3">{slot.label}</span>
      {player ? (
        <PlayerRow
          player={player}
          locked={locked}
          lockExempt={lockExempt}
          weekIsCurrent={weekIsCurrent}
          currentWeek={currentWeek}
          readOnly={readOnly}
          selected={selected === player.player_id}
          onSelect={() => onSelect(player.player_id)}
          hints={[...(hint ? [hint] : []), ...storedFlags]}
          kickoff={kickoff}
          leagueTimeZone={leagueTimeZone}
          trailing={
            !readOnly && !frozen ? (
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
  /** Commissioner override mode: the 🔒 badge stays, the wall comes down. */
  lockExempt?: boolean
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

function PlayerRow({ player, locked, lockExempt, weekIsCurrent, currentWeek, readOnly, selected, onSelect, hints, kickoff, leagueTimeZone, trailing }: PlayerRowProps) {
  const frozen = locked && !lockExempt
  const draggable = useDraggable({ id: player.player_id, disabled: readOnly || frozen })
  const lock = lockBadgeFor(player.game_lock, weekIsCurrent)
  const stint = irStintChip(player, currentWeek)
  const kickoffView = kickoff ? formatKickoff(kickoff, leagueTimeZone) : null

  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
      <button
        ref={draggable.setNodeRef}
        type="button"
        {...draggable.attributes}
        {...(readOnly || frozen ? {} : draggable.listeners)}
        data-player={player.player_id}
        aria-pressed={selected}
        aria-disabled={readOnly || frozen}
        onClick={readOnly || frozen ? undefined : onSelect}
        className={cn(
          'flex min-w-[180px] flex-1 items-center gap-1.5 rounded-sm border px-1.5 py-0.5 text-left text-[11px] font-bold',
          readOnly || frozen ? 'cursor-default border-transparent' : 'cursor-grab border-transparent hover:border-ink hover:bg-n-4 active:cursor-grabbing',
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
  lockExempt?: boolean
  weekIsCurrent: boolean
  currentWeek: number | null
  readOnly: boolean
  selected: string | null
  onSelect: (id: string) => void
  onDropSelected: () => void
  empty: boolean
}

function BenchZone({ bench, locked, lockExempt, weekIsCurrent, currentWeek, readOnly, selected, onSelect, onDropSelected, empty }: BenchZoneProps) {
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
                lockExempt={lockExempt}
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

/** `formatKickoff` lives in `lineup-editor-ops.ts` since L.D5.4 (F275(d)) —
 *  re-exported so an existing import path keeps working; new callers import
 *  the ops module and leave the drag stack out of their bundle. */
export { formatKickoff }
