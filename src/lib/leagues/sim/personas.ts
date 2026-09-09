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
  /** SEASON MODE ONLY (L.D6.3 / F288). Absent on a draft-mode run, which is
   *  what keeps the M2/M3 gates' stored-literal seed-42 sim runs byte-identical
   *  — those personas are untouched. */
  seasonNeed?: SeasonNeedContext
}

/**
 * What a season-mode seat needs, so a persona can draft like a manager rather
 * than like a pure-ADP list reader — F288.
 *
 * WHY. `SEASON_ROSTER` starts six positions off `SEASON_ROUNDS = 7`, and the
 * restored local pool puts the first K at ADP rank ~138 and the first D/ST at
 * ~95 (measured 2026-09-08). A 16-team league makes 112 picks and an 8-team
 * league 56, so a pure-ADP board reaches NO kicker at any league size and, in
 * the small sizes, no defense either: every league's K slot (and often D/ST)
 * was structurally empty, the K and D/ST scoring rules went unexercised in a
 * whole gate run, and `lineupSlotsLeftEmpty` — printed but entering nothing —
 * let 71/96 filled slots read as a fully seated league. That is the
 * "nothing happened means it worked" shape CLAUDE.md opens with.
 *
 * WHAT. The server's own need-aware autopick (086:552-748) builds slot
 * capacities from `roster_settings`, computes need and unfilled, and FORCES a
 * need-filling pick once `remaining <= unfilled`. This mirrors that rule. It
 * is self-correcting: a seat cannot spend a free pick that would make some
 * starting slot unreachable, because the very next call sees `unfilled >=
 * remaining` and forces.
 */
export interface SeasonNeedContext {
  /** The league's starting slots, in canonical order. */
  slots: readonly { key: string; eligible: readonly string[] }[]
  /** Player ids this seat has ALREADY drafted. */
  rosterPlayerIds: readonly string[]
  /** Total draftable rounds — `picksRemaining` is derived, never passed. */
  rounds: number
  /** Roster-vocabulary position of an available id (DEF normalised to DST). */
  positionOf: (playerId: string) => string | null
  /** TRUE when §7.3.6 would refuse this player as a STARTER in THIS league —
   *  a blocking designation in an `allow_illegal_lineups = false` league. Such
   *  a player never counts as filling a need and is never taken as a need
   *  pick, because the seat has ONE bench seat and no cover for him. */
  blockedAsStarter: (playerId: string) => boolean
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

/**
 * Which starting slots this seat still cannot seat — a greedy first fit of the
 * roster's positions over the slots in canonical order, the same shape
 * `chooseStarterSlots` uses when the sim actually seats the lineup. A player
 * the league would refuse as a starter fills nothing.
 *
 * Pure and exported so the sweep can falsify it directly.
 */
export function unfilledStartingSlots(
  need: SeasonNeedContext,
): readonly { key: string; eligible: readonly string[] }[] {
  const taken = new Set<string>()
  for (const playerId of need.rosterPlayerIds) {
    if (need.blockedAsStarter(playerId)) continue
    const position = need.positionOf(playerId)
    if (position === null) continue
    const slot = need.slots.find((sl) => !taken.has(sl.key) && sl.eligible.includes(position))
    if (slot !== undefined) taken.add(slot.key)
  }
  return need.slots.filter((sl) => !taken.has(sl.key))
}

/**
 * The best available player who fills a slot this seat still cannot seat.
 * ADP order, no reach: a forced need pick takes the best man, exactly as the
 * server's autopick does (086:552-748). Null when nobody in the pool window
 * can fill any unfilled slot — a LOUD absence the caller reports rather than
 * papering over (the seat then falls back to ADP and the slot stays empty,
 * which `lineupSlotsLeftEmpty` counts).
 */
export function bestForNeed(ctx: PickContext, need: SeasonNeedContext): string | null {
  const unfilled = unfilledStartingSlots(need)
  if (unfilled.length === 0) return null
  const wanted = new Set(unfilled.flatMap((sl) => [...sl.eligible]))
  for (const playerId of ctx.availableByAdp) {
    if (need.blockedAsStarter(playerId)) continue
    const position = need.positionOf(playerId)
    if (position !== null && wanted.has(position)) return playerId
  }
  return null
}

/** TRUE when this seat can no longer afford a free pick: every remaining pick
 *  is needed to seat a starting slot (086's `remaining <= unfilled` rule). */
export function mustFillNeed(need: SeasonNeedContext): boolean {
  const unfilled = unfilledStartingSlots(need).length
  const remaining = need.rounds - need.rosterPlayerIds.length
  return unfilled > 0 && unfilled >= remaining
}

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
  // SEASON MODE (F288): once a seat can no longer afford a free pick, it takes
  // the best available man who fills a slot it still cannot seat — the rng is
  // consumed FIRST and unconditionally above, so a season run's decision
  // stream stays a pure function of the seed whichever branch is taken.
  const needChoice =
    ctx.seasonNeed !== undefined && mustFillNeed(ctx.seasonNeed)
      ? bestForNeed(ctx, ctx.seasonNeed)
      : null
  const adpChoice = needChoice ?? ctx.availableByAdp[reachIndex]!

  if (persona === 'queue-drafter') {
    return {
      kind: 'pick',
      // A forced need pick outranks the seat's own queue head: a manager whose
      // remaining picks are all spoken for abandons the queue too (F288).
      playerId: needChoice ?? ctx.queue[0] ?? adpChoice,
      doubleTap: false,
      strayPlayerId: null,
    }
  }
  if (persona === 'chaos') {
    // The rng is consumed unconditionally so the decision stream stays a pure
    // function of the seed in both modes.
    const wantsStray = rng() < 0.5
    const stray =
      wantsStray && ctx.availableByAdp.length > reachIndex + 1
        ? ctx.availableByAdp[reachIndex + 1]!
        : null
    return {
      kind: 'pick',
      playerId: adpChoice,
      doubleTap: true,
      // F288: a stray pick that LANDS (it can, legally, at a snake corner —
      // the last seat of a round owns picks N and N+1 back-to-back) spends one
      // of this seat's picks on a NON-need player, and with SEVEN rounds for
      // six starting slots there is exactly one spare pick to lose. Suppressed
      // in season mode while ANY starting slot is still unfilled — not merely
      // while the seat is already FORCED, because a stray landing at the last
      // corner consumes the pick the force would have used and there is no
      // later turn to self-correct (measured: one short seat per league at k
      // or dst, run to run). E2's double-tap replay — what `chaos` exists to
      // exercise — is untouched, the stray still fires once the seat is fully
      // seated, and DRAFT mode never reaches this branch at all.
      strayPlayerId:
        ctx.seasonNeed !== undefined && unfilledStartingSlots(ctx.seasonNeed).length > 0
          ? null
          : stray,
    }
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
