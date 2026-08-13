/**
 * Roster-tracker derivation — pure ops for `my-roster-tracker.tsx` (M2 task
 * L.B3.2; spec §8.5.2 "my roster (slots filling up)", §16.2
 * `my-roster-tracker` "slots filling up + needs").
 *
 * This is a DISPLAY-ONLY READ-MODEL of the same greedy the server documents
 * — migration 068's banner steps a–b (+ the step-c counters), mirrored so
 * the needs surface the room shows agrees with what the tick's autopick
 * will actually do:
 *   a. normalize `players.position` 'DEF' → 'DST' (the roster_settings
 *      vocabulary);
 *   b. assign MY live picks greedily IN PICK ORDER: each fills the FIRST
 *      unfilled starting slot (in `roster_settings.starting_slots` array
 *      order) whose eligible set contains the normalized position,
 *      otherwise a bench seat (greedy, order-dependent — the documented
 *      limitation; E16's bipartite matching is M4's lineup validator);
 *   c. unfilled = Σ over starting slots of (count − filled).
 * Nothing here decides anything (D90): the server's greedy re-runs
 * authoritatively inside `draft_autopick_resolve`; this model only renders.
 *
 * Picks whose player identity hasn't loaded yet (broadcast hint rows before
 * the keyed players refetch) land in `pending` — the tracker shows them as
 * counted-but-unplaced rather than guessing a slot.
 */

import type { StartingSlot } from '@/lib/leagues/settings/league-settings'

/** 068 step a: the research-surface 'DEF' spelling → roster 'DST'. */
export function normalizePosition(position: string): string {
  return position === 'DEF' ? 'DST' : position
}

export interface TrackerSlotView {
  key: string
  label: string
  count: number
  /** Player ids filling this slot (length ≤ count), in pick order. */
  playerIds: string[]
}

export interface RosterTrackerModel {
  slots: TrackerSlotView[]
  /** Bench occupants in pick order (may exceed benchCount only via
   *  commissioner moves — rendered honestly, never clipped). */
  benchIds: string[]
  benchCount: number
  /** Step c: starting seats still to fill (the "needs" number). */
  unfilled: number
  /** Picks counted but not yet placeable (identity still loading). */
  pendingIds: string[]
}

export interface RosterTrackerInput {
  /** MY team's picks (any order; undone rows ignored here). */
  picks: ReadonlyArray<{ pick_number: number; player_id: string; is_undone: boolean | null }>
  /** player_id ↦ players.position (raw spelling fine — step a normalizes). */
  positionById: ReadonlyMap<string, string>
  startingSlots: readonly StartingSlot[]
  bench: number
}

export function buildRosterTracker(input: RosterTrackerInput): RosterTrackerModel {
  const slots: TrackerSlotView[] = input.startingSlots.map((slot) => ({
    key: slot.key,
    label: slot.label,
    count: slot.count,
    playerIds: [],
  }))
  const eligibleBySlot = input.startingSlots.map((slot) => new Set(slot.eligible.map(normalizePosition)))

  const ordered = input.picks
    .filter((p) => !p.is_undone)
    .slice()
    .sort((a, b) => a.pick_number - b.pick_number)

  const benchIds: string[] = []
  const pendingIds: string[] = []

  for (const pick of ordered) {
    const rawPosition = input.positionById.get(pick.player_id)
    if (!rawPosition) {
      pendingIds.push(pick.player_id)
      continue
    }
    const position = normalizePosition(rawPosition)
    // Step b: first unfilled eligible starting slot in ARRAY order.
    const target = slots.find(
      (slot, i) => slot.playerIds.length < slot.count && eligibleBySlot[i].has(position),
    )
    if (target) target.playerIds.push(pick.player_id)
    else benchIds.push(pick.player_id)
  }

  const unfilled = slots.reduce((sum, slot) => sum + (slot.count - slot.playerIds.length), 0)

  return { slots, benchIds, benchCount: input.bench, unfilled, pendingIds }
}
