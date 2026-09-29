/**
 * Trade center fixtures (M5 L.D3.7) — `GET …/trades` documents in the shape
 * D417(4) serves (`trades-service.ts`'s `TradeView` / `TradesDocument`), and
 * two rosters in the rosters route's shape. Test-only.
 */
import type { RosterPlayer, RosterTeam } from '@/lib/leagues/api/rosters-service'
import type { TradeDeadlineView, TradePreview, TradeRosterFacts, TradeView, TradeVoteTally, TradesDocument } from '@/lib/leagues/api/trades-service'

export const ALPHA = 'aaaaaaaa-0000-4000-8000-000000000001'
export const BRAVO = 'aaaaaaaa-0000-4000-8000-000000000002'
export const CHARLIE = 'aaaaaaaa-0000-4000-8000-000000000003'
export const LEAGUE = 'league-1'

export function player(id: string, name: string, position = 'WR', team = 'AAA') {
  return { player_id: id, full_name: name, position, nfl_team: team }
}

export function trade(over: Partial<TradeView> = {}): TradeView {
  return {
    id: 'tr-1',
    status: 'proposed',
    status_reason: null,
    in_flight: true,
    proposer: { team_id: ALPHA, name: 'Alpha' },
    recipient: { team_id: BRAVO, name: 'Bravo' },
    note: null,
    countered_from: null,
    created_at: '2099-09-14T15:00:00.000Z',
    accepted_at: null,
    resolved_at: null,
    items: [
      { from_team_id: ALPHA, to_team_id: BRAVO, player: player('p-a1', 'Andy One'), faab_amount: null },
      { from_team_id: BRAVO, to_team_id: ALPHA, player: player('p-b1', 'Ben One', 'RB', 'BBB'), faab_amount: null },
    ],
    drops: [],
    review: null,
    deferred: null,
    tally: null,
    ...over,
  }
}

export function tally(over: Partial<TradeVoteTally> = {}): TradeVoteTally {
  return {
    trade_id: 'tr-1',
    review: 'league_vote',
    status: 'in_review',
    veto_votes: 1,
    eligible_voters: 6,
    setting: 4,
    veto_number: 4,
    capped: false,
    voting_open: true,
    closes_at: '2099-09-15T15:00:00.000Z',
    my_vote: null,
    can_vote: true,
    cannot_vote_because: null,
    evaluated_at: '2099-09-14T20:00:00.000Z',
    ...over,
  }
}

export function doc(trades: TradeView[], over: Partial<TradesDocument> = {}): TradesDocument {
  return {
    league_id: LEAGUE,
    status: 'all',
    team_id: null,
    viewer: { team_id: BRAVO, is_commissioner: false },
    settings: {
      trade_review: 'commissioner',
      trade_review_period_hours: 24,
      trade_deadline_week: 11,
      trade_lock_behavior: 'defer',
      allow_faab_in_trades: false,
      allow_future_considerations: false,
    },
    evaluated_at: '2099-09-14T20:00:00.000Z',
    trades,
    ...over,
  }
}

export function rosterPlayer(id: string, name: string, over: Partial<RosterPlayer> = {}): RosterPlayer {
  return {
    player_id: id,
    full_name: name,
    position: 'WR',
    nfl_team: 'AAA',
    status: 'Active',
    bye_week: null,
    slot_key: 'bn',
    acquisition_type: 'draft',
    acquisition_cost: null,
    ir_placed_week: null,
    ir_lock_until_week: null,
    acquired_at: null,
    pool_state: 'rostered',
    game_lock: { state: 'unlocked', until: null },
    ...over,
  }
}

export function rosterTeam(teamId: string, name: string, roster: RosterPlayer[], over: Partial<RosterTeam> = {}): RosterTeam {
  return {
    team_id: teamId,
    name,
    owner_id: 'u',
    status: 'active',
    manager_user_id: `m-${name}`,
    autopilot: false,
    faab_balance: 100,
    waiver_priority: null,
    roster,
    ...over,
  }
}

export const TEAMS: RosterTeam[] = [
  rosterTeam(ALPHA, 'Alpha', [rosterPlayer('p-a1', 'Andy One'), rosterPlayer('p-a2', 'Art Two', { position: 'QB' })]),
  rosterTeam(BRAVO, 'Bravo', [
    rosterPlayer('p-b1', 'Ben One', { position: 'RB', nfl_team: 'BBB' }),
    rosterPlayer('p-b2', 'Bo Two', { game_lock: { state: 'locked_until', until: '2099-09-15T07:00:00.000Z' } }),
    rosterPlayer('p-b3', 'Bud Three', { position: 'TE' }),
  ]),
  rosterTeam(CHARLIE, 'Charlie', [rosterPlayer('p-c1', 'Cal One')]),
]

// ---------------------------------------------------------------------------
// L.D3.12 — the server's deadline and its legality preview (162), in the
// shapes `trade_deadline` / `trade_preview` answer (pgTAP 110 pins them).
// ---------------------------------------------------------------------------

export function deadlineView(over: Partial<TradeDeadlineView> = {}): TradeDeadlineView {
  return {
    league_id: LEAGUE,
    deadline_week: 11,
    deadline_at: '2099-11-18T05:00:00.000Z',
    why: 'next_week_starts',
    label: 'Wed 2099-11-18 00:00 America/New_York',
    passed: false,
    ms_remaining: 86_400_000,
    evaluated_at: '2099-11-17T05:00:00.000Z',
    ...over,
  }
}

export function facts(teamId: string, over: Partial<TradeRosterFacts> = {}): TradeRosterFacts {
  return {
    team_id: teamId,
    count_before: 3,
    players_out: 1,
    players_in: 1,
    drops: 0,
    count_after: 3,
    roster_size: 3,
    must_drop: 0,
    enforced: true,
    ...over,
  }
}

export function preview(over: Partial<TradePreview> = {}, sides: { proposer?: Partial<TradeRosterFacts>; recipient?: Partial<TradeRosterFacts> } = {}): TradePreview {
  return {
    mode: 'offer',
    league_id: LEAGUE,
    trade_id: null,
    proposer_team_id: ALPHA,
    recipient_team_id: BRAVO,
    ok: true,
    league_status: 'in_season',
    in_season: true,
    deadline: deadlineView(),
    refusal: null,
    rosters: { proposer: facts(ALPHA, sides.proposer), recipient: facts(BRAVO, { enforced: false, ...sides.recipient }) },
    evaluated_at: '2099-11-17T05:00:00.000Z',
    ...over,
  }
}
