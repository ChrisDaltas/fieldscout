/**
 * The mobile "Swap player" sheet — which players can trade places with the
 * tapped seat (FieldScout Mobile handoff, League › Team §2.2 / §3).
 *
 * The handoff lists, for a tapped seat, everyone who can SWAP with it: the
 * other starting seats where both players fit (`fits(s2,a) && fits(sa,b)`),
 * then the bench, then one empty bench seat. This file maps that onto the
 * app's lineup model and NEVER decides legality itself: every candidate is
 * the move `planMove` (`lineup-editor-ops.ts`, the desktop editor's one
 * planner) accepts — the kickoff lock (`game_lock`), position eligibility,
 * the IR designation, a Restricted IR stint and a kept starter's seat all
 * refuse there, so a refused move is simply not offered (prevent, don't
 * refuse). The server's `set_lineup` stays the decider after the tap.
 *
 * Differences from the prototype, by the app's own model:
 *   - The bench is a SET (no order is stored), so bench-to-bench "swaps" are
 *     not offered — they would change nothing.
 *   - Benching a starter is always possible in the app (the bench has no
 *     seat cap in `slot_map`), so a filled starter always gets the "Empty"
 *     bench row.
 *   - IR seats are the app's (the handoff has none): offered under "Reserve"
 *     to a player with an IR designation, and an IR player can come back to
 *     a seat he fits or to the bench.
 */
import {
  designationOf,
  KEPT_STARTER_COPY,
  planMove,
  positionMatches,
  type MoveContext,
  type MoveTarget,
  type Placement,
  type SlotInstance,
} from '@/components/leagues/lineup-editor-ops'
import type { RosterPlayer } from '@/lib/leagues/api/rosters-service'

import { shortName, slotCode } from './team-ops'

export type SwapSelection =
  /** A starting or IR seat, filled or empty. */
  | { kind: 'slot'; key: string }
  /** A player on the bench. */
  | { kind: 'bench'; playerId: string }
  /** An empty bench seat. */
  | { kind: 'bench-empty'; index: number }

/** A row as the sheet draws it: the seat's chip and who sits there. */
export interface SwapRow {
  /** null = the bench chip ("BN"). */
  slot: SlotInstance | null
  player: RosterPlayer | null
}

export interface SwapCandidate {
  id: string
  section: 'starters' | 'bench' | 'reserve'
  row: SwapRow
  move: { playerId: string; target: MoveTarget }
  /** The handoff's toast: "Swapped A.J. Brown and J. Williams", "Moved
   *  K. Bourne to bench", "Moved S. Sanders to QB". */
  toast: string
}

export type SwapOptions =
  | { kind: 'locked'; selected: SwapRow; message: string }
  | { kind: 'list'; selected: SwapRow; starters: SwapCandidate[]; bench: SwapCandidate[]; reserve: SwapCandidate[] }

export interface SwapInput {
  placement: Placement
  slots: readonly SlotInstance[]
  /** Rostered players by id. */
  players: ReadonlyMap<string, RosterPlayer>
  /** The bench in display order (rostered, not placed). */
  bench: readonly RosterPlayer[]
  ctx: MoveContext
}

function fits(slot: SlotInstance, p: RosterPlayer | null): boolean {
  if (!p) return true
  if (slot.kind === 'ir') return designationOf(p.status) !== null
  return positionMatches(p.position, slot.eligible)
}

/** An IR occupant still on a Restricted stint can't be moved out of his seat
 *  (the planner checks only the MOVER's stint; this covers the one it
 *  displaces — stricter, never looser). */
function stintHolds(p: RosterPlayer | null, currentWeek: number | null): boolean {
  return Boolean(p && p.ir_lock_until_week !== null && currentWeek !== null && currentWeek < p.ir_lock_until_week)
}

function short(p: RosterPlayer): string {
  return shortName(p.full_name, p.position)
}

function lockedMessage(p: RosterPlayer): string {
  return `${p.full_name} is locked — his game has started, so he stays where he is until it’s over.`
}

/** The swap sheet's contents for a tapped seat. */
export function swapOptions(sel: SwapSelection, input: SwapInput): SwapOptions {
  const { placement, slots, players, bench, ctx } = input
  const occupant = (key: string) => {
    const id = placement[key]
    return id ? (players.get(id) ?? null) : null
  }
  const isLocked = (p: RosterPlayer | null) => Boolean(p && ctx.locked.has(p.player_id) && !ctx.lockExempt)
  const ok = (playerId: string, target: MoveTarget) => planMove(placement, playerId, target, ctx).ok
  const seats = slots.filter((s) => s.kind === 'start')
  const irSeats = slots.filter((s) => s.kind === 'ir')

  const starters: SwapCandidate[] = []
  const benchOut: SwapCandidate[] = []
  const reserve: SwapCandidate[] = []

  if (sel.kind === 'slot') {
    const S = slots.find((s) => s.key === sel.key)
    if (!S) return { kind: 'list', selected: { slot: null, player: null }, starters, bench: benchOut, reserve }
    const A = occupant(S.key)
    const selected: SwapRow = { slot: S, player: A }
    if (A && isLocked(A)) return { kind: 'locked', selected, message: lockedMessage(A) }
    if (!A && ctx.kept?.has(S.key) && !ctx.lockExempt) {
      return { kind: 'locked', selected, message: `${S.label} is locked — the player there was ${KEPT_STARTER_COPY}.` }
    }

    // Other seats (starting, then IR): a true swap — both fit.
    for (const T of [...seats, ...irSeats]) {
      if (T.key === S.key) continue
      const C = occupant(T.key)
      if (!A && !C) continue
      let move: SwapCandidate['move']
      if (A) {
        if (!fits(T, A)) continue
        // An IR seat's player can't be re-seated by the planner (it benches
        // him), so from IR only an empty seat is a clean move.
        if (C && (S.kind === 'ir' || !fits(S, C))) continue
        if (T.kind === 'ir' && stintHolds(C, ctx.currentWeek)) continue
        move = { playerId: A.player_id, target: { kind: 'slot', key: T.key } }
      } else {
        if (!fits(S, C)) continue
        move = { playerId: C!.player_id, target: { kind: 'slot', key: S.key } }
      }
      if (!ok(move.playerId, move.target)) continue
      const toast = A && C ? `Swapped ${short(A)} and ${short(C)}` : A ? `Moved ${short(A)} to ${slotCode(T)}` : `Moved ${short(C!)} to ${slotCode(S)}`
      ;(T.kind === 'ir' ? reserve : starters).push({ id: `slot:${T.key}`, section: T.kind === 'ir' ? 'reserve' : 'starters', row: { slot: T, player: C }, move, toast })
    }

    // The bench: a bench player who fits this seat comes in (A goes to the
    // bench), then one empty bench seat for A. An IR seat whose occupant is
    // still on a Restricted stint can't be emptied by someone coming in
    // (the planner checks only the mover's stint — `stintHolds`).
    const occupantHeld = S.kind === 'ir' && stintHolds(A, ctx.currentWeek)
    for (const B of occupantHeld ? [] : bench) {
      if (!fits(S, B)) continue
      const move = { playerId: B.player_id, target: { kind: 'slot', key: S.key } as MoveTarget }
      if (!ok(move.playerId, move.target)) continue
      benchOut.push({
        id: `bench:${B.player_id}`,
        section: 'bench',
        row: { slot: null, player: B },
        move,
        toast: A ? `Swapped ${short(A)} and ${short(B)}` : `Moved ${short(B)} to ${slotCode(S)}`,
      })
    }
    if (A && ok(A.player_id, { kind: 'bench' })) {
      benchOut.push({
        id: 'bench:empty',
        section: 'bench',
        row: { slot: null, player: null },
        move: { playerId: A.player_id, target: { kind: 'bench' } },
        toast: `Moved ${short(A)} to bench`,
      })
    }
    return { kind: 'list', selected, starters, bench: benchOut, reserve }
  }

  if (sel.kind === 'bench') {
    const B = players.get(sel.playerId) ?? null
    const selected: SwapRow = { slot: null, player: B }
    if (!B) return { kind: 'list', selected, starters, bench: benchOut, reserve }
    if (isLocked(B)) return { kind: 'locked', selected, message: lockedMessage(B) }
    for (const T of [...seats, ...irSeats]) {
      if (!fits(T, B)) continue
      const C = occupant(T.key)
      if (T.kind === 'ir' && stintHolds(C, ctx.currentWeek)) continue
      const move = { playerId: B.player_id, target: { kind: 'slot', key: T.key } as MoveTarget }
      if (!ok(move.playerId, move.target)) continue
      const toast = C ? `Swapped ${short(B)} and ${short(C)}` : `Moved ${short(B)} to ${slotCode(T)}`
      ;(T.kind === 'ir' ? reserve : starters).push({ id: `slot:${T.key}`, section: T.kind === 'ir' ? 'reserve' : 'starters', row: { slot: T, player: C }, move, toast })
    }
    return { kind: 'list', selected, starters, bench: benchOut, reserve }
  }

  // An empty bench seat: any seated player can come to the bench.
  const selected: SwapRow = { slot: null, player: null }
  for (const T of [...seats, ...irSeats]) {
    const C = occupant(T.key)
    if (!C) continue
    const move = { playerId: C.player_id, target: { kind: 'bench' } as MoveTarget }
    if (!ok(move.playerId, move.target)) continue
    ;(T.kind === 'ir' ? reserve : starters).push({
      id: `slot:${T.key}`,
      section: T.kind === 'ir' ? 'reserve' : 'starters',
      row: { slot: T, player: C },
      move,
      toast: `Moved ${short(C)} to bench`,
    })
  }
  return { kind: 'list', selected, starters, bench: benchOut, reserve }
}

/** "No eligible players for this slot" — nothing to offer. */
export function swapIsEmpty(options: SwapOptions): boolean {
  return options.kind === 'list' && options.starters.length === 0 && options.bench.length === 0 && options.reserve.length === 0
}
