/**
 * Auction-room derivation — the PURE model behind `auction-block.tsx`
 * (M3 task L.C3.1; spec §8.6/§8.6.1, §16.2 `auction-block`, §16.3
 * one-glance clarity, §16.4's v2.10 auction-room-layout callout; tasks-M3
 * D126/D128/D129).
 *
 * The colocated-ops split this folder runs on (`draft-board-ops.ts`,
 * `status-strip-ops.ts`, `command-bar-ops.ts`): every question the room
 * answers with a rendering — which phase, whose turn, which column is mine,
 * which column placed the latest bid, what the bid box may offer — is a
 * pure function of the drafts row + the picks + the bid feed, so it is
 * falsifiable without a socket or a DOM.
 *
 * **Nothing here decides anything** (the D90/§4.7 rule this file inherits
 * from `auction-budget.ts`): the server's `draft_nominate` /
 * `draft_place_bid` (085/089) validate every bid under the draft-row lock
 * against `draft_team_budget` (084), and the RPC's own refusal copy is what
 * the room shows when it refuses. The max-bid cap surfaced here exists to
 * PREVENT E5's refusal at the UI rather than to enforce it — an over-cap
 * amount is disabled locally AND refused by the server if it ever gets
 * through (L.C3.1 banner item 1: "E5's message prevented at the UI").
 *
 * Phase is `current_nomination`'s NULLity (D126) — read through
 * `readLiveNomination` in `auction-budget.ts`, which is also the F64
 * identity a bid must name (`nomination_seq` = `drafts.current_pick_number`
 * until the award — D157(2)).
 *
 * Wall-clock-free, exactly like `pick-clock-ops.ts`: the anti-snipe view
 * takes sampled `nowMs` + the heartbeat-corrected `offsetMs` as parameters.
 */

import type { StartingSlot } from '@/lib/leagues/settings/league-settings'

import type { LiveNomination, TeamBudget } from './auction-budget'
import { buildRosterTracker } from './roster-tracker-ops'

// ---------------------------------------------------------------------------
// Phase (D126)
// ---------------------------------------------------------------------------

/** `current_nomination` NULL ⇒ a nominator is on the clock; non-NULL ⇒ open
 *  bidding on that player (D126 — no phase column exists, and none is owed). */
export type AuctionPhase = 'nominating' | 'bidding'

export function auctionPhase(nomination: LiveNomination | null): AuctionPhase {
  return nomination === null ? 'nominating' : 'bidding'
}

// ---------------------------------------------------------------------------
// Team columns (§16.4's v2.10 callout — the layout contract, as a model)
// ---------------------------------------------------------------------------

/** One drafted player in a team's column, with its price (§12.7/D134). */
export interface AuctionColumnPick {
  pickNumber: number
  playerId: string
  price: number | null
}

/** A starting seat this team still has to fill — the "which roster positions
 *  remain undrafted" half of §16.4's callout. `count` collapses repeats
 *  (`WR ×2`) so a 20-slot roster still reads at column width. */
export interface AuctionColumnNeed {
  key: string
  label: string
  count: number
}

/**
 * One team's column (a row on mobile). §16.4's callout, item by item:
 * drafted players with prices (`picks`) · which roster positions remain
 * undrafted (`needs`) · total spots left (`budget.openSlots`) · total
 * remaining budget (`budget.remaining`) · current max bid
 * (`budget.maxBid`) — plus the three at-a-glance marks.
 */
export interface AuctionTeamColumn {
  teamId: string
  name: string
  /** 0-based position in `drafts.nomination_order` — the column order. */
  orderIndex: number
  /** MY franchise (a mock's launcher holds the human seat — D103(2)). */
  isMe: boolean
  /** The team `on_clock_team_id` names: the nominator while NOMINATING, and
   *  (unchanged, deliberately) still the nominator while bidding is open —
   *  the drafts row does not move the clock off the nominator mid-nomination. */
  isNominating: boolean
  /** Holds the live high bid (`current_nomination.high_bidder_team_id`) —
   *  the "latest bid" mark. Null nomination ⇒ nobody holds it. */
  isLatestBid: boolean
  /** Null exactly where `draft_team_budget` would raise (no derivable
   *  capacity) — render nothing, never guess (`auction-budget.ts`). */
  budget: TeamBudget | null
  needs: AuctionColumnNeed[]
  picks: AuctionColumnPick[]
  /** No open slots ⇒ skipped in the rotation and cannot bid (§8.6.7(c)/E27). */
  rosterComplete: boolean
}

export interface AuctionColumnsInput {
  /** `drafts.nomination_order`, already parsed to team ids (the column
   *  ORDER — §16.4: "ordered by nomination order"). Empty ⇒ the caller's
   *  fallback order is used verbatim. */
  nominationOrder: readonly string[]
  /** Every franchise the room renders, with its display name. */
  teams: ReadonlyArray<{ id: string; name: string }>
  /** The draft's whole pick list — undone rows included; filtered here
   *  exactly as `teamBudget` filters them. */
  picks: ReadonlyArray<{
    pick_number: number
    team_id: string
    player_id: string
    price?: number | null
    is_undone: boolean | null
  }>
  /** Per-team budgets from the parity-pinned mirror (`teamBudgets`). */
  budgets: ReadonlyMap<string, TeamBudget | null>
  /** player_id ↦ `players.position` (raw spelling — the tracker normalizes). */
  positionById: ReadonlyMap<string, string>
  startingSlots: readonly StartingSlot[]
  bench: number
  myTeamId: string | null
  /** `drafts.on_clock_team_id` — the nominator (D126). */
  nominatingTeamId: string | null
  /** The live nomination, or null while nominating. */
  nomination: LiveNomination | null
}

/**
 * Every franchise as a column, ordered by NOMINATION ORDER (§16.4). Teams
 * absent from `nomination_order` (a franchise retired mid-draft, or an order
 * that predates a seat change) sort after the ordered ones, by name — they
 * are rendered, never dropped: a column that vanishes is a team whose spend
 * silently stops being visible.
 */
export function buildAuctionColumns(input: AuctionColumnsInput): AuctionTeamColumn[] {
  const orderIndexById = new Map<string, number>()
  input.nominationOrder.forEach((teamId, i) => {
    if (!orderIndexById.has(teamId)) orderIndexById.set(teamId, i)
  })

  const picksByTeam = new Map<string, AuctionColumnPick[]>()
  for (const pick of input.picks) {
    if (pick.is_undone === true) continue
    const list = picksByTeam.get(pick.team_id)
    const entry: AuctionColumnPick = {
      pickNumber: pick.pick_number,
      playerId: pick.player_id,
      price: pick.price ?? null,
    }
    if (list) list.push(entry)
    else picksByTeam.set(pick.team_id, [entry])
  }
  for (const list of picksByTeam.values()) list.sort((a, b) => a.pickNumber - b.pickNumber)

  const columns = input.teams.map((team) => {
    const budget = input.budgets.get(team.id) ?? null
    const teamPicks = picksByTeam.get(team.id) ?? []
    return {
      teamId: team.id,
      name: team.name,
      orderIndex: orderIndexById.get(team.id) ?? Number.MAX_SAFE_INTEGER,
      isMe: input.myTeamId !== null && team.id === input.myTeamId,
      isNominating: input.nominatingTeamId !== null && team.id === input.nominatingTeamId,
      isLatestBid:
        input.nomination !== null && input.nomination.high_bidder_team_id === team.id,
      budget,
      needs: needsForTeam(input, team.id),
      picks: teamPicks,
      rosterComplete: budget !== null && budget.openSlots <= 0,
    }
  })

  return columns.sort((a, b) =>
    a.orderIndex !== b.orderIndex
      ? a.orderIndex - b.orderIndex
      : a.name.localeCompare(b.name),
  )
}

/** The unfilled starting seats, collapsed to one row per slot (068's greedy
 *  as a display read-model — `roster-tracker-ops.ts`, reused rather than
 *  re-implemented). Bench seats are not a POSITION need and are carried by
 *  `openSlots` instead. */
function needsForTeam(input: AuctionColumnsInput, teamId: string): AuctionColumnNeed[] {
  const model = buildRosterTracker({
    picks: input.picks
      .filter((p) => p.team_id === teamId)
      .map((p) => ({
        pick_number: p.pick_number,
        player_id: p.player_id,
        is_undone: p.is_undone,
      })),
    positionById: input.positionById,
    startingSlots: input.startingSlots,
    bench: input.bench,
  })
  const needs: AuctionColumnNeed[] = []
  for (const slot of model.slots) {
    const open = slot.count - slot.playerIds.length
    if (open > 0) needs.push({ key: slot.key, label: slot.label, count: open })
  }
  return needs
}

// ---------------------------------------------------------------------------
// The bid box (§8.6.1 max bid; §8.6.7(d); E5 prevented at the UI)
// ---------------------------------------------------------------------------

/** Why the bid box cannot take an action right now — each maps to one
 *  sentence the box renders. `null` ⇒ the action is offered. */
export type BidBlocker =
  /** Not in this draft (spectator, or a mock's non-launcher — D103(2)). */
  | 'no-seat'
  /** The draft is paused (or otherwise not live) — clocks are frozen. */
  | 'not-live'
  /** My roster is full: skipped in the rotation, cannot bid (§8.6.7(c)/E27). */
  | 'roster-complete'
  /** I hold the high bid — raising myself is refused by the RPC (E25 arm). */
  | 'already-high'
  /** My max bid cannot reach the next legal raise (§8.6.7(d) exhausted). */
  | 'max-bid-reached'
  /** Not my turn to nominate. */
  | 'not-nominator'

export interface BidBoxModel {
  phase: AuctionPhase
  /** The smallest amount the server will accept from me right now:
   *  `high_bid + 1` while bidding, `auction_min_bid` while nominating
   *  (§8.6.2/§8.6.3; C38 — a $0 opening is legal when `min_bid` is 0). */
  minAmount: number
  /** My ceiling from the parity-pinned mirror (§8.6.1) — null when the
   *  budget is underivable, in which case the box renders no cap rather
   *  than an invented one. */
  maxAmount: number | null
  /** True when the action is offered; false ⇒ `blocker` says why. */
  canAct: boolean
  blocker: BidBlocker | null
}

export interface BidBoxInput {
  phase: AuctionPhase
  /** `drafts.status` — only `live` accepts a bid (a paused clock is frozen). */
  status: string
  myTeamId: string | null
  myBudget: TeamBudget | null
  nomination: LiveNomination | null
  nominatingTeamId: string | null
  minBid: number
}

/**
 * What the bid/nominate box may offer. The ORDER of the blocker checks is
 * the order a user meets them, and it is deliberate: seat before liveness
 * before roster before turn/ownership before money, so the sentence shown
 * is the first true reason rather than the narrowest one.
 */
export function buildBidBox(input: BidBoxInput): BidBoxModel {
  const bidding = input.phase === 'bidding'
  const minAmount = bidding ? (input.nomination?.high_bid ?? 0) + 1 : input.minBid
  const maxAmount = input.myBudget?.maxBid ?? null

  const blocker = ((): BidBlocker | null => {
    if (!input.myTeamId) return 'no-seat'
    if (input.status !== 'live') return 'not-live'
    if (input.myBudget !== null && input.myBudget.openSlots <= 0) return 'roster-complete'
    if (bidding) {
      if (input.nomination?.high_bidder_team_id === input.myTeamId) return 'already-high'
    } else if (input.nominatingTeamId !== input.myTeamId) {
      return 'not-nominator'
    }
    if (maxAmount !== null && maxAmount < minAmount) return 'max-bid-reached'
    return null
  })()

  return {
    phase: input.phase,
    minAmount,
    maxAmount,
    canAct: blocker === null,
    blocker,
  }
}

/** Is this typed amount submittable? Integer, ≥ the minimum, and ≤ the cap
 *  when a cap is derivable — the E5 prevention. A non-integer or empty box
 *  is never submittable (the RPC takes an integer). */
export function bidAmountAcceptable(box: BidBoxModel, amount: number): boolean {
  if (!box.canAct) return false
  if (!Number.isInteger(amount)) return false
  if (amount < box.minAmount) return false
  if (box.maxAmount !== null && amount > box.maxAmount) return false
  return true
}

// ---------------------------------------------------------------------------
// Anti-snipe (E6 / D128) — the clock floor, and its visible re-arm
// ---------------------------------------------------------------------------

export interface AntiSnipeView {
  /** `auction_anti_snipe_seconds` (0 ⇒ the floor is disabled — a pure fixed
   *  window; §7.3.8/D128). */
  seconds: number
  /** The floor exists for this draft (`seconds > 0`) AND we are bidding. */
  active: boolean
  /** The countdown is inside the floor window — any bid landing now resets
   *  the clock TO the floor (D128's own words: "resets clock **to it**"). */
  inWindow: boolean
  /** The last observed deadline moved LATER: the floor visibly re-armed
   *  (E6: 3s left, threshold 10 → the clock reads 10s again). */
  reArmed: boolean
}

export interface AntiSnipeInput {
  phase: AuctionPhase
  status: string
  antiSnipeSeconds: number
  /** `drafts.current_deadline` (ISO) — the bid clock while bidding. */
  currentDeadline: string | null
  /** The deadline the room held BEFORE this render's drafts row. Null on
   *  first paint. A LATER deadline **for the same nomination** is a re-arm —
   *  the only client-observable signature of 085's floor, and it needs no new
   *  wire field to see. */
  previousDeadline: string | null
  /** The nomination this deadline belongs to (`seq:player`), and the one the
   *  previous deadline belonged to. **The scope is load-bearing, and it was
   *  a measured find**: the NOMINATING→BIDDING transition also moves the
   *  deadline later (the nomination clock's remainder is replaced by a fresh
   *  `auction_bid_seconds` window), and the first cut of this function read
   *  that as a floor re-arm — the browser pass showed "Anti-snipe — clock
   *  reset to 10s" the instant a nomination opened, with no bid in sight.
   *  Requiring the key to be UNCHANGED confines the claim to what 085
   *  actually does: extend the CURRENT nomination's clock. */
  nominationKey: string | null
  previousNominationKey: string | null
  /** Sampled client clock + the heartbeat-corrected offset (§9.3 — no
   *  wall-clock read lives in this module). */
  nowMs: number
  offsetMs: number
}

/** The nomination a deadline belongs to. `null` while nominating (there is
 *  no nomination to extend), so a re-arm can never be claimed off the
 *  phase change itself. */
export function nominationKeyOf(
  nominationSeq: number | null,
  nomination: LiveNomination | null,
): string | null {
  if (nomination === null || nominationSeq === null) return null
  return `${nominationSeq}:${nomination.player_id}`
}

export function antiSnipeView(input: AntiSnipeInput): AntiSnipeView {
  const seconds = Number.isInteger(input.antiSnipeSeconds) ? input.antiSnipeSeconds : 0
  const active = seconds > 0 && input.phase === 'bidding' && input.status === 'live'
  const deadlineMs = instantMs(input.currentDeadline)
  const previousMs = instantMs(input.previousDeadline)
  const remainingMs = deadlineMs === null ? null : deadlineMs - (input.nowMs + input.offsetMs)
  return {
    seconds,
    active,
    inWindow:
      active && remainingMs !== null && remainingMs > 0 && remainingMs <= seconds * 1000,
    reArmed:
      active &&
      deadlineMs !== null &&
      previousMs !== null &&
      deadlineMs > previousMs &&
      input.nominationKey !== null &&
      input.nominationKey === input.previousNominationKey,
  }
}

function instantMs(iso: string | null | undefined): number | null {
  if (iso == null) return null
  const ms = Date.parse(iso)
  return Number.isNaN(ms) ? null : ms
}

// ---------------------------------------------------------------------------
// The bid feed, as the centerpiece renders it
// ---------------------------------------------------------------------------

export interface BidHistoryRow {
  teamId: string
  amount: number
  /** `draft_bids.created_at` is NULLable in the generated types; the column
   *  is DEFAULT now() so a real row always has one, and a null sorts last
   *  rather than crashing the ladder. */
  createdAt: string | null
}

/**
 * The live nomination's raises, newest first — the "who is bidding" half of
 * §16.3's one-glance clarity. Scoped to the CURRENT `nomination_seq` (the
 * feed carries the whole draft's live history) and capped, because a long
 * ladder is scrollback, not state.
 */
export function nominationBidHistory(
  rows: ReadonlyArray<{
    nomination_seq: number
    team_id: string
    amount: number
    created_at: string | null
  }>,
  nominationSeq: number | null,
  limit = 6,
): BidHistoryRow[] {
  if (nominationSeq === null) return []
  return rows
    .filter((row) => row.nomination_seq === nominationSeq)
    .slice()
    .sort((a, b) =>
      a.amount !== b.amount
        ? b.amount - a.amount
        : (b.created_at ?? '').localeCompare(a.created_at ?? ''),
    )
    .slice(0, limit)
    .map((row) => ({ teamId: row.team_id, amount: row.amount, createdAt: row.created_at }))
}
