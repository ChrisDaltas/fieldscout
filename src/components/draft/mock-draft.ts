// Draft room fixtures — types + mock data for the snake and auction rooms.
//
// TODO(live-draft): the league/draft backend does not exist yet. Everything
// in this file is a hand-written fixture shaped like the data a live draft
// service would push (board state, auction state, budgets). When the backend
// lands, keep the exported types, delete the MOCK_* constants, and feed the
// rooms from the live channel instead.

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

/** Round number (1-based) for an overall pick in a snake draft. */
export function roundForPick(pick: number, teamCount: number): number {
  return Math.floor((pick - 1) / teamCount) + 1
}

/** Which manager owns an overall pick, given the round-1 slot order. */
export function managerForPick(
  pick: number,
  managers: readonly string[],
): string {
  const teamCount = managers.length
  const round = roundForPick(pick, teamCount)
  const indexInRound = (pick - 1) % teamCount
  const slot = round % 2 === 1 ? indexInRound : teamCount - 1 - indexInRound
  return managers[slot]
}

/** "Christian McCaffrey" → "C. McCaffrey" (board cells are narrow). */
export function abbreviateName(fullName: string): string {
  const parts = fullName.split(' ')
  if (parts.length < 2) return fullName
  return `${parts[0][0]}. ${parts.slice(1).join(' ')}`
}

// TODO(live-draft): replace with the league record once leagues exist.
export const MOCK_LEAGUE: MockLeague = {
  id: 'mock-league',
  name: 'The Work League',
  teamCount: 10,
  rounds: 15,
  draftFormat: 'snake',
}

// 10-team snake, you draft from slot 8: picks 8, 13, 28, … Round 1 plus the
// turn is done; pick 13 (yours) is on the clock.
// TODO(live-draft): board state comes from the draft service.
export const MOCK_SNAKE_DRAFT: SnakeDraftState = {
  currentPick: 13,
  pickClockSeconds: 48,
  managers: [
    'Marcus',
    'Priya',
    'Devon',
    'Sara',
    'Tom',
    'Alex',
    'Jordan',
    'You',
    'Casey',
    'Riley',
  ],
  board: [
    { pick: 1, playerName: 'Christian McCaffrey', position: 'RB', team: 'SF', byManager: 'Marcus' },
    { pick: 2, playerName: 'CeeDee Lamb', position: 'WR', team: 'DAL', byManager: 'Priya' },
    { pick: 3, playerName: 'Tyreek Hill', position: 'WR', team: 'MIA', byManager: 'Devon' },
    { pick: 4, playerName: 'Bijan Robinson', position: 'RB', team: 'ATL', byManager: 'Sara' },
    { pick: 5, playerName: "Ja'Marr Chase", position: 'WR', team: 'CIN', byManager: 'Tom' },
    { pick: 6, playerName: 'Justin Jefferson', position: 'WR', team: 'MIN', byManager: 'Alex' },
    { pick: 7, playerName: 'Saquon Barkley', position: 'RB', team: 'PHI', byManager: 'Jordan' },
    { pick: 8, playerName: 'Jahmyr Gibbs', position: 'RB', team: 'DET', byManager: 'You' },
    { pick: 9, playerName: 'Josh Allen', position: 'QB', team: 'BUF', byManager: 'Casey' },
    { pick: 10, playerName: 'Amon-Ra St. Brown', position: 'WR', team: 'DET', byManager: 'Riley' },
    { pick: 11, playerName: 'Derrick Henry', position: 'RB', team: 'BAL', byManager: 'Riley' },
    { pick: 12, playerName: 'Garrett Wilson', position: 'WR', team: 'NYJ', byManager: 'Casey' },
  ],
  // TODO(live-draft): Scout AI pick advice comes from the AI service.
  aiSuggestion: {
    heading: 'Scout AI suggests: Sam LaPorta',
    body: 'You opened with Gibbs at the turn. Elite TE is thinning fast — LaPorta is the last in his tier and fills your biggest positional gap.',
  },
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

// TODO(live-draft): auction state comes from the draft service; bids and
// nominations in the room are a local simulation on top of this fixture.
export const MOCK_AUCTION_DRAFT: AuctionDraftState = {
  budget: 200,
  bidClockSeconds: 14,
  nominated: {
    playerName: 'Christian McCaffrey',
    position: 'RB',
    team: 'SF',
    bye: 9,
    value: 66,
    projectedPts: 270.7,
  },
  nominatedBy: 'Air Raid',
  currentOffer: 56,
  offerBy: 'Sunday Scaries',
  bidHistory: [
    { team: 'Sunday Scaries', amount: 56 },
    { team: 'Air Raid', amount: 55 },
    { team: 'Check Downs', amount: 54 },
    { team: 'Lambeau Leapers', amount: 53 },
  ],
  teams: [
    { name: 'You', budget: 200, maxBid: 187, slots: 13 },
    { name: 'Sunday Scaries', budget: 129, maxBid: 117, slots: 12 },
    { name: 'Air Raid', budget: 200, maxBid: 187, slots: 13, nominating: true },
    { name: 'Lambeau Leapers', budget: 182, maxBid: 170, slots: 12 },
    { name: 'Check Downs', budget: 129, maxBid: 117, slots: 12 },
    { name: 'The Audibles', budget: 126, maxBid: 115, slots: 11 },
    { name: 'Gridiron Gurus', budget: 200, maxBid: 187, slots: 13 },
    { name: 'Pepperbox', budget: 129, maxBid: 117, slots: 12 },
  ],
  nominees: [
    { playerName: 'Jonathan Taylor', position: 'RB', team: 'IND', bye: 13, value: 65 },
    { playerName: 'Amon-Ra St. Brown', position: 'WR', team: 'DET', bye: 6, value: 65 },
    { playerName: 'CeeDee Lamb', position: 'WR', team: 'DAL', bye: 7, value: 64 },
    { playerName: 'Derrick Henry', position: 'RB', team: 'BAL', bye: 14, value: 62 },
    { playerName: 'Justin Jefferson', position: 'WR', team: 'MIN', bye: 6, value: 60 },
  ],
  yourBudget: {
    remaining: 200,
    total: 200,
    maxBid: 187,
    slotsLeft: 13,
    avgPerSlot: 15,
  },
  // TODO(live-draft): Scout AI bid advice comes from the AI service.
  aiSuggestion: {
    heading: "Don't chase past $58",
    body: "McCaffrey's value is $66, but you're already strong at RB. At $58+ you'd overpay and choke your WR budget. Let it ride to Sunday Scaries and pivot to St. Brown.",
  },
}
