/**
 * Bot persona policies — M2 task L.B6.1 (delivery plan §4.2; tasks-M2 §5;
 * D100). PURE seeded policies: every decision derives from the persona,
 * the visible state, and the rng stream — the runner supplies both and
 * performs the I/O (real service-layer calls, never direct DB writes).
 *
 * The four M2 personas:
 *   - `adp-drafter`  — manual picks near the top of the available-by-ADP
 *     list (a small seeded reach keeps boards from being identical).
 *   - `queue-drafter` — maintains a real queue over the L.B2.2 route and
 *     picks its own queue head (ADP fallback when the queue runs dry).
 *   - `afk`          — never acts: its picks are the tick's D102 timeout
 *     path (STALE human seat → held to deadline + grace → autopick).
 *   - `chaos`        — double-taps everything (E2's charter): every pick
 *     submitted TWICE with the SAME action_id (the replay must answer the
 *     same pick), sometimes a stray concurrent pick with a DIFFERENT
 *     action_id (the engine must refuse one of the two), and every queue
 *     save DOUBLE-TAPPED concurrently — the F54 reproduction vehicle
 *     (two whole-queue replaces for one seat interleaving into duplicate
 *     ranks; this task observes and records, it does not fix).
 */
import type { PersonaKind } from './sim-types'

export interface PickContext {
  /** Available (undrafted) player ids, ADP ascending — the bot's pool view. */
  availableByAdp: readonly string[]
  /** The seat's own queue in rank order, ALREADY filtered to available. */
  queue: readonly string[]
}

export type PickDecision =
  | {
      kind: 'pick'
      playerId: string
      /** Chaos: submit the pick twice with ONE action_id (E2 on the wire). */
      doubleTap: boolean
      /** Chaos: a concurrent second pick (different player, different
       *  action_id) — exactly one of the two may land. */
      strayPlayerId: string | null
    }
  | { kind: 'timeout' }

/** How deep an ADP-driven persona may reach (seeded variety without ever
 *  drafting junk): index 0..2 of the available list. */
const ADP_REACH = 3

export function decidePick(
  persona: PersonaKind,
  ctx: PickContext,
  rng: () => number,
): PickDecision {
  if (persona === 'afk') return { kind: 'timeout' }
  if (ctx.availableByAdp.length === 0) return { kind: 'timeout' }

  const reachIndex = Math.min(
    Math.floor(rng() * ADP_REACH),
    ctx.availableByAdp.length - 1,
  )
  const adpChoice = ctx.availableByAdp[reachIndex]!

  if (persona === 'queue-drafter') {
    return {
      kind: 'pick',
      playerId: ctx.queue[0] ?? adpChoice,
      doubleTap: false,
      strayPlayerId: null,
    }
  }
  if (persona === 'chaos') {
    const stray =
      rng() < 0.5 && ctx.availableByAdp.length > reachIndex + 1
        ? ctx.availableByAdp[reachIndex + 1]!
        : null
    return { kind: 'pick', playerId: adpChoice, doubleTap: true, strayPlayerId: stray }
  }
  // adp-drafter
  return { kind: 'pick', playerId: adpChoice, doubleTap: false, strayPlayerId: null }
}

/** Queue depth the queue personas maintain. */
const QUEUE_DEPTH = 5

export interface QueuePlan {
  /** The queue to save (whole-queue replace semantics — L.B2.2/§12.6). */
  players: string[]
  /** Chaos: a SECOND, different order submitted concurrently with the
   *  first — the F54 double-tap. Null for everyone else. */
  concurrentAlternate: string[] | null
}

/**
 * The queue a persona wants before its pick. `queue-drafter` refreshes when
 * its queue is empty; `chaos` churns its queue EVERY turn (two conflicting
 * concurrent saves). Others never touch the queue.
 */
export function desiredQueue(
  persona: PersonaKind,
  ctx: PickContext,
  rng: () => number,
): QueuePlan | null {
  if (persona === 'queue-drafter') {
    if (ctx.queue.length > 0) return null
    // Seeded skip: start 0..2 deep and take the next QUEUE_DEPTH available.
    const start = Math.min(Math.floor(rng() * 3), Math.max(0, ctx.availableByAdp.length - 1))
    return {
      players: ctx.availableByAdp.slice(start, start + QUEUE_DEPTH),
      concurrentAlternate: null,
    }
  }
  if (persona === 'chaos') {
    const a = ctx.availableByAdp.slice(0, QUEUE_DEPTH)
    // The alternate is DISJOINT from the primary on purpose: with
    // overlapping sets the interleave trips the (draft_id, team_id,
    // player_id) unique instead — the loser's INSERT fails wholesale and
    // one caller eats a 500 (the same unprotected delete→insert window
    // wearing its partial-failure face, D113(3)). Disjoint sets let both
    // INSERTs land, which is the F54 duplicate-RANK signature the D39
    // append race produced (two different players → two rank-1 rows).
    const b = [...ctx.availableByAdp.slice(QUEUE_DEPTH, QUEUE_DEPTH * 2)].reverse()
    if (a.length === 0 || b.length === 0) return null
    return { players: a, concurrentAlternate: b }
  }
  return null
}
