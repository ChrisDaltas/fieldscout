// Draft room fixture TYPES + display helpers.
//
// M2 (task L.B3.2) executed this file's original instruction: the backend
// landed, the `MOCK_*` fixture constants are DELETED, and the snake room
// renders live data (drafts + draft_picks over `useDraftRoom`). What
// remains, deliberately:
//   - the exported fixture TYPES — the auction room (`auction-draft-room
//     .tsx`, untouched until M3 per tasks-M2 C25) still types against them;
//   - `abbreviateName` — the board-cell display helper.
// The pure order helpers (`roundForPick`/`managerForPick`) moved to
// `draft-order.ts` as `roundForPick`/`teamForPick` — the D90 display
// mirror, parity-pinned against migration 066's `draft_team_for_pick`
// (draft-order.test.ts + draft-order-parity-db.test.ts). M3 replaces the
// auction types with live shapes and this file goes away entirely.

export type DraftFormat = 'snake' | 'auction'

export interface MockLeague {
  id: string
  name: string
  teamCount: number
  rounds: number
  /** Draft format from league settings — the ?format= param overrides it. */
  draftFormat: DraftFormat
}

/* ------------------------------- Snake ---------------------------------- */

export interface SnakeBoardPick {
  pick: number
  playerName: string
  position: string
  team: string
  byManager: string
}

export interface DraftAiSuggestion {
  heading: string
  body: string
}

export interface SnakeDraftState {
  /** Overall pick currently on the clock. */
  currentPick: number
  /** Seconds each pick gets on the clock. */
  pickClockSeconds: number
  /** Draft slot order, round 1 — snake order derives from this. */
  managers: string[]
  board: SnakeBoardPick[]
  aiSuggestion: DraftAiSuggestion
}

/** "Christian McCaffrey" → "C. McCaffrey" (board cells are narrow). */
export function abbreviateName(fullName: string): string {
  const parts = fullName.split(' ')
  if (parts.length < 2) return fullName
  return `${parts[0][0]}. ${parts.slice(1).join(' ')}`
}

/* ------------------------------ Auction --------------------------------- */

export interface AuctionTeamBudget {
  name: string
  /** Remaining budget. */
  budget: number
  /** Max single bid (budget minus $1 reserved per open slot). */
  maxBid: number
  /** Roster slots still to fill. */
  slots: number
  /** Currently nominating team — accent-tinted card + Nom badge. */
  nominating?: boolean
}

export interface AuctionNominee {
  playerName: string
  position: string
  team: string
  bye: number
  /** Pre-draft auction value. */
  value: number
}

export interface AuctionNominatedPlayer extends AuctionNominee {
  projectedPts?: number
}

export interface AuctionBid {
  team: string
  amount: number
}

export interface AuctionDraftState {
  /** Full starting budget per team. */
  budget: number
  bidClockSeconds: number
  nominated: AuctionNominatedPlayer
  nominatedBy: string
  currentOffer: number
  offerBy: string
  bidHistory: AuctionBid[]
  /** "You" first — the strip renders in this order. */
  teams: AuctionTeamBudget[]
  nominees: AuctionNominee[]
  yourBudget: {
    remaining: number
    total: number
    maxBid: number
    slotsLeft: number
    avgPerSlot: number
  }
  aiSuggestion: DraftAiSuggestion
}
