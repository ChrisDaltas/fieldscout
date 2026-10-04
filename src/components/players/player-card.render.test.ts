/**
 * The player card everywhere, with league actions — League UX batch 2
 * (Chris 2026-10-03: "when I click on a player who is on my roster, there is
 * no option to drop them and the player detail card is not opening up").
 *
 *  1. The door: `PlayerLink` / `PlayerFace` render a card door (no shadow),
 *     and the store opens the card with the context given — else the
 *     surface's ambient one (the draft room), else global.
 *  2. The card's league view per state: free agent / on waivers / yours /
 *     theirs / locked / full roster / deadline passed / no manager / not in
 *     season / no seat — every closed door with its reason.
 *  3. The FAAB stepper's bounds and the feed's player parts.
 *  4. The actions block rendered per state.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it } from 'vitest'

import type { PoolPlayer } from '@/components/draft/available-players-ops'
import { LOCKED_ADD_TITLE, LOCKED_DROP_TITLE } from '@/components/leagues/players-page-ops'
import type { PoolRow } from '@/hooks/use-league-pool'
import type { LeagueRosters, RosterPlayer, RosterTeam } from '@/lib/leagues/api/rosters-service'
import type { WaiverWindowView } from '@/lib/leagues/waivers/waiver-window-view'
import { usePlayerWindowsStore } from '@/stores/player-windows-store'

import { DraftCardActions, LeagueActionsBody } from './player-card-actions'
import { GLOBAL_CARD_CONTEXT, leagueCardContext } from './player-card-context'
import {
  acquireLabel,
  bidAllowed,
  cardLeagueView,
  claimPlacedCopy,
  dropConfirmCopy,
  MOVES_AFTER_SEASON_COPY,
  MOVES_BEFORE_SEASON_COPY,
  movesGate,
  NO_MANAGER_COPY,
  NO_SEAT_CARD_COPY,
  ROSTER_FULL_COPY,
  stepBid,
  TRADE_DEADLINE_PASSED_COPY,
  type CardLeagueInput,
} from './player-card-league-ops'
import { PlayerFace, PlayerLink, TextWithPlayers } from './player-link'
import { playerParts } from './player-link-ops'

const html = (el: ReactElement) =>
  renderToStaticMarkup(createElement(QueryClientProvider, { client: new QueryClient() }, el))
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const UNLOCKED = { state: 'unlocked' as const, until: null }
const LOCKED = { state: 'locked_until' as const, until: '2099-09-14T07:00:00Z' }

function rp(id: string, over: Partial<RosterPlayer> = {}): RosterPlayer {
  return {
    player_id: id,
    full_name: `Player ${id}`,
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
    game_lock: UNLOCKED,
    ...over,
  }
}

function team(id: string, roster: RosterPlayer[], over: Partial<RosterTeam> = {}): RosterTeam {
  return { team_id: id, name: `Team ${id}`, owner_id: `o-${id}`, status: 'active', manager_user_id: `u-${id}`, autopilot: false, faab_balance: 40, waiver_priority: 1, roster, ...over }
}

const OPEN_FA: WaiverWindowView = {
  waivers: true,
  free_agency_open: true,
  why: 'free_agency' as WaiverWindowView['why'],
  next_run_at: '2099-09-16T07:00:00Z',
  last_run_at: null,
  last_open_at: null,
  time_zone: 'America/New_York',
  paused: false,
  evaluated_at: '2099-09-12T12:00:00Z',
}

const player = (id: string): PoolPlayer => ({ id, full_name: `Player ${id}`, position: 'WR', team: 'AAA', adp: null, headshot_url: null, status: 'Active' })

function input(over: Partial<CardLeagueInput> & { rosters?: Pick<LeagueRosters, 'teams'> } = {}): CardLeagueInput {
  return {
    player: player('p-free'),
    leagueName: 'Sunday League',
    leagueStatus: 'in_season',
    rosters: { teams: [team('mine', [rp('p-mine'), rp('p-locked', { game_lock: LOCKED })]), team('them', [rp('p-theirs')])] },
    pool: [],
    myTeamId: 'mine',
    rosterSize: 16,
    waiverType: 'faab',
    waiverWindow: OPEN_FA,
    claimsLive: true,
    tradesClosed: false,
    minBid: 1,
    nextRunLocal: 'Wed 3:00 AM',
    formatInstant: (iso) => iso,
    ...over,
  }
}

// ---------------------------------------------------------------------------
// 1. The door
// ---------------------------------------------------------------------------

describe('PlayerLink / PlayerFace — the one player door', () => {
  beforeEach(() => usePlayerWindowsStore.setState({ windows: [], ambient: null }))

  it('a name renders as a card door with the house link treatment and never a shadow', () => {
    const out = html(createElement(PlayerLink, { playerId: 'p1', name: 'Bijan Robinson', context: leagueCardContext('lg'), className: 'font-bold' }))
    expect(out).toMatch(/^<button type="button" data-player-link="p1" class="[^"]*fs-entity-link[^"]*decoration-transparent[^"]*hover:decoration-current[^"]*font-bold">Bijan Robinson<\/button>$/)
    expect(out).not.toMatch(/shadow-/)
  })
  it('a headshot renders as a door named for the player', () => {
    const out = html(createElement(PlayerFace, { playerId: 'p1', name: 'Bijan Robinson', context: GLOBAL_CARD_CONTEXT }))
    expect(out).toContain('data-player-face="p1"')
    expect(out).toContain('aria-label="Open Bijan Robinson"')
    expect(out).toContain('>BR<')
    expect(out).not.toMatch(/shadow-/)
  })
  it('open: the explicit context wins; else the ambient one (the draft room); else global', () => {
    const store = usePlayerWindowsStore.getState()
    store.open('p1')
    expect(usePlayerWindowsStore.getState().windows[0].context).toEqual({ kind: 'global' })
    const draft = { kind: 'draft' as const, leagueId: 'lg', draftId: 'd1', teamId: 't1' }
    usePlayerWindowsStore.getState().setAmbient(draft)
    usePlayerWindowsStore.getState().open('p2')
    expect(usePlayerWindowsStore.getState().windows.find((w) => w.playerId === 'p2')?.context).toEqual(draft)
    usePlayerWindowsStore.getState().open('p3', { context: leagueCardContext('lg') })
    expect(usePlayerWindowsStore.getState().windows.find((w) => w.playerId === 'p3')?.context).toEqual({ kind: 'league', leagueId: 'lg' })
    // The global card's "open him in that league" re-points the open card.
    usePlayerWindowsStore.getState().setContext('p1', leagueCardContext('lg2'))
    expect(usePlayerWindowsStore.getState().windows.find((w) => w.playerId === 'p1')?.context).toEqual({ kind: 'league', leagueId: 'lg2' })
  })
})

// ---------------------------------------------------------------------------
// 2. The league view per state
// ---------------------------------------------------------------------------

describe('cardLeagueView — where he is, and the one move that fits', () => {
  it('free agent: Add live, no Claim while free agency is open; the line names the league', () => {
    const v = cardLeagueView(input())
    expect(v.kind).toBe('available')
    expect(v.where).toBe('Free agent in Sunday League')
    if (v.kind !== 'available') throw new Error('kind')
    expect(v.add).toEqual({ show: true, disabled: false, title: undefined })
    expect(v.claim).toEqual({ show: false })
    expect(v.needsDrop).toBe(false)
    expect(v.faab).toEqual({ min: 1, max: 40 })
  })
  it('on waivers: Claim (a FAAB bid) and the line says so', () => {
    const v = cardLeagueView(input({ pool: [{ player_id: 'p-free', state: 'on_waivers', waivers_until: '2099-09-16T07:00:00Z', game_lock: UNLOCKED } as PoolRow] }))
    expect(v.where).toBe('On waivers in Sunday League')
    if (v.kind !== 'available') throw new Error('kind')
    expect(v.claim.show).toBe(true)
    expect(v.add.show && v.add.title).toContain('On waivers until 2099-09-16T07:00:00Z')
  })
  it('a full roster (count = roster_size, IR counted) needs a drop picked', () => {
    const v = cardLeagueView(input({ rosterSize: 2 }))
    if (v.kind !== 'available') throw new Error('kind')
    expect(v.needsDrop).toBe(true)
    expect(v.myRoster.map((p) => p.player_id)).toEqual(['p-mine', 'p-locked'])
    // One under the size: no drop needed (the boundary).
    const under = cardLeagueView(input({ rosterSize: 3 }))
    if (under.kind !== 'available') throw new Error('kind')
    expect(under.needsDrop).toBe(false)
  })
  it('a locked free agent: Add closed with the lock’s reason', () => {
    const v = cardLeagueView(input({ pool: [{ player_id: 'p-free', state: 'locked_in_game', waivers_until: null, game_lock: LOCKED } as PoolRow] }))
    if (v.kind !== 'available') throw new Error('kind')
    expect(v.add).toEqual({ show: true, disabled: true, title: LOCKED_ADD_TITLE })
  })
  it('yours: Drop open; locked — closed with the lock’s reason; outside the season — closed with the league’s', () => {
    const mine = cardLeagueView(input({ player: player('p-mine') }))
    expect(mine.where).toBe('On your team in Sunday League')
    expect(mine.kind === 'mine' && mine.drop).toEqual({ open: true })
    const locked = cardLeagueView(input({ player: player('p-locked') }))
    expect(locked.kind === 'mine' && locked.drop).toEqual({ open: false, reason: LOCKED_DROP_TITLE })
    const drafting = cardLeagueView(input({ player: player('p-mine'), leagueStatus: 'drafting' }))
    expect(drafting.kind === 'mine' && drafting.drop).toEqual({ open: false, reason: MOVES_BEFORE_SEASON_COPY })
    const done = cardLeagueView(input({ player: player('p-mine'), leagueStatus: 'complete' }))
    expect(done.kind === 'mine' && done.drop).toEqual({ open: false, reason: MOVES_AFTER_SEASON_COPY })
  })
  it('pickups close outside the season too (157 admits moves only in_season / playoffs)', () => {
    expect(movesGate('in_season')).toEqual({ open: true })
    expect(movesGate('playoffs')).toEqual({ open: true })
    expect(movesGate('setup')).toEqual({ open: false, reason: MOVES_BEFORE_SEASON_COPY })
    const v = cardLeagueView(input({ leagueStatus: 'drafting' }))
    if (v.kind !== 'available') throw new Error('kind')
    expect(v.add).toEqual({ show: true, disabled: true, title: MOVES_BEFORE_SEASON_COPY })
  })
  it('theirs: Propose trade open; past the deadline, toward a team with no manager, or with no team of my own — closed with the reason', () => {
    const v = cardLeagueView(input({ player: player('p-theirs') }))
    expect(v.where).toBe('On Team them · Sunday League')
    expect(v.kind === 'theirs' && v.trade).toEqual({ open: true })
    const late = cardLeagueView(input({ player: player('p-theirs'), tradesClosed: true }))
    expect(late.kind === 'theirs' && late.trade).toEqual({ open: false, reason: TRADE_DEADLINE_PASSED_COPY })
    const orphan = cardLeagueView(
      input({ player: player('p-theirs'), rosters: { teams: [team('mine', []), team('them', [rp('p-theirs')], { manager_user_id: null })] } }),
    )
    expect(orphan.kind === 'theirs' && orphan.trade).toEqual({ open: false, reason: NO_MANAGER_COPY })
    const seatless = cardLeagueView(input({ player: player('p-theirs'), myTeamId: null }))
    expect(seatless.kind === 'theirs' && seatless.trade).toEqual({ open: false, reason: NO_SEAT_CARD_COPY })
  })
  it('no seat: a free agent shows where he is and no move', () => {
    expect(cardLeagueView(input({ myTeamId: null })).kind).toBe('no_seat')
  })
})

// D481 (Chris 2026-10-03, "just make it a plus button instead of claim vs
// add"): one state → one verb for the "+".
describe('acquireAction — the one + per state', () => {
  const WAIVERS = { player_id: 'p-free', state: 'on_waivers', waivers_until: '2099-09-16T07:00:00Z', game_lock: UNLOCKED } as PoolRow
  const CLAIMS_ONLY: WaiverWindowView = { ...OPEN_FA, free_agency_open: false, why: 'awaiting_run' as WaiverWindowView['why'] }
  const acq = (over: Partial<CardLeagueInput>) => {
    const v = cardLeagueView(input(over))
    if (v.kind !== 'available') throw new Error('kind')
    return v.acquire
  }
  it('free agency open → add', () => {
    expect(acq({})).toEqual({ kind: 'add', disabled: false })
  })
  it('on waivers (FAAB or rolling) → claim', () => {
    expect(acq({ pool: [WAIVERS] })).toEqual({ kind: 'claim', disabled: false })
    expect(acq({ pool: [WAIVERS], waiverType: 'rolling_priority' })).toEqual({ kind: 'claim', disabled: false })
  })
  it('the claims-only window → claim, even for a free agent', () => {
    expect(acq({ waiverWindow: CLAIMS_ONLY })).toEqual({ kind: 'claim', disabled: false })
  })
  it('no waivers in the league → add, even in what would be a claims window', () => {
    expect(acq({ waiverType: 'none_fcfs', waiverWindow: CLAIMS_ONLY })).toEqual({ kind: 'add', disabled: false })
    expect(acq({ claimsLive: false, pool: [WAIVERS] })).toEqual({ kind: 'add', disabled: false })
  })
  it('the window unknown: a free agent → add (the server decides); on waivers → claim', () => {
    expect(acq({ waiverWindow: null })).toEqual({ kind: 'add', disabled: false })
    expect(acq({ waiverWindow: null, pool: [WAIVERS] })).toEqual({ kind: 'claim', disabled: false })
  })
  it('a full roster keeps the verb (the press asks for the drop)', () => {
    expect(acq({ rosterSize: 2 })).toEqual({ kind: 'add', disabled: false })
    expect(acq({ rosterSize: 2, pool: [WAIVERS] })).toEqual({ kind: 'claim', disabled: false })
  })
  it('locked → none, with the lock’s reason', () => {
    expect(acq({ pool: [{ player_id: 'p-free', state: 'locked_in_game', waivers_until: null, game_lock: LOCKED } as PoolRow] })).toEqual({
      kind: 'none',
      disabled: true,
      title: LOCKED_ADD_TITLE,
    })
  })
  it('outside the season → none, with the league’s reason (before and after)', () => {
    expect(acq({ leagueStatus: 'drafting' })).toEqual({ kind: 'none', disabled: true, title: MOVES_BEFORE_SEASON_COPY })
    expect(acq({ leagueStatus: 'complete', pool: [WAIVERS] })).toEqual({ kind: 'none', disabled: true, title: MOVES_AFTER_SEASON_COPY })
  })
  it('the label says what a press does; the placed claim says when it processes', () => {
    expect(acquireLabel('add', 'Josh Allen')).toBe('Add Josh Allen')
    expect(acquireLabel('claim', 'Josh Allen')).toBe('Claim Josh Allen')
    expect(claimPlacedCopy('Josh Allen', 'Wed 3:00 AM')).toBe('Claim placed for Josh Allen — processes Wed 3:00 AM.')
    expect(claimPlacedCopy('Josh Allen', null)).toBe('Claim placed for Josh Allen — processes at the next waiver run.')
  })
})

// ---------------------------------------------------------------------------
// 3. Bounds and parts
// ---------------------------------------------------------------------------

describe('the FAAB stepper holds the bid inside [minimum, balance]', () => {
  const b = { min: 1, max: 40 }
  it('steps, and clamps at both ends (boundary values)', () => {
    expect(stepBid(1, -1, b)).toBe(1)
    expect(stepBid(2, -1, b)).toBe(1)
    expect(stepBid(39, 1, b)).toBe(40)
    expect(stepBid(40, 1, b)).toBe(40)
    expect(stepBid(5, 1, { min: 0, max: null })).toBe(6)
  })
  it('only a whole dollar inside the bounds may be sent', () => {
    expect(bidAllowed(1, b)).toBe(true)
    expect(bidAllowed(40, b)).toBe(true)
    expect(bidAllowed(0, b)).toBe(false)
    expect(bidAllowed(41, b)).toBe(false)
    expect(bidAllowed(2.5, b)).toBe(false)
    expect(bidAllowed(999, { min: 0, max: null })).toBe(true)
  })
})

describe('playerParts — the names a composed sentence carries become doors', () => {
  it('splits at each named player in reading order; a name the text lacks is not linked', () => {
    expect(playerParts('added Nine (WR · AAA), dropped One', [{ playerId: 'p1', name: 'One' }, { playerId: 'p9', name: 'Nine' }, { playerId: 'x', name: 'Ghost' }])).toEqual([
      'added ',
      { playerId: 'p9', name: 'Nine' },
      ' (WR · AAA), dropped ',
      { playerId: 'p1', name: 'One' },
    ])
    expect(playerParts('Commissioner move', [])).toEqual(['Commissioner move'])
  })
  it('two players whose names overlap never claim the same characters', () => {
    expect(playerParts('added Lee, dropped Lee Smith', [{ playerId: 'a', name: 'Lee Smith' }, { playerId: 'b', name: 'Lee' }])).toEqual([
      'added ',
      { playerId: 'b', name: 'Lee' },
      ', dropped ',
      { playerId: 'a', name: 'Lee Smith' },
    ])
  })
  it('TextWithPlayers renders the same words with the doors in place', () => {
    const out = html(createElement(TextWithPlayers, { text: 'added Nine (WR)', players: [{ playerId: 'p9', name: 'Nine' }], context: leagueCardContext('lg') }))
    expect(out).toMatch(/^added <button type="button" data-player-link="p9"[^>]*>Nine<\/button> \(WR\)$/)
  })
})

// ---------------------------------------------------------------------------
// 4. The block per state
// ---------------------------------------------------------------------------

describe('LeagueActionsBody — a render per state', () => {
  const body = (over: Partial<CardLeagueInput> = {}, myTeamId: string | null = 'mine') =>
    html(createElement(LeagueActionsBody, { view: cardLeagueView(input(over)), leagueId: 'lg', myTeamId }))

  // D481 (Chris 2026-10-03): ONE "+" — never a separate Add / Claim / Bid.
  const ONE_PLUS = (out: string) => {
    expect(out.match(/data-card-action="/g)).toHaveLength(1)
    expect(out).not.toMatch(/data-card-action="(add|claim|bid)"/)
    expect(out).not.toMatch(/>(Add|Claim|Bid)<\/button>/)
  }
  it('free agent: one green + that adds, named for him, and the line', () => {
    const out = body()
    expect(out).toContain('data-card-league="available"')
    expect(out).toContain('Free agent in Sunday League')
    expect(out).toMatch(/<button[^>]*bg-positive[^>]*aria-label="Add Player p-free"[^>]*data-card-action="acquire" data-acquire="add"/)
    expect(out).toContain('<svg')
    ONE_PLUS(out)
    expect(out).not.toContain(ROSTER_FULL_COPY)
  })
  it('on waivers in a FAAB league: one + that claims; the bid opens only on a press', () => {
    const out = body({ pool: [{ player_id: 'p-free', state: 'on_waivers', waivers_until: '2099-09-16T07:00:00Z', game_lock: UNLOCKED } as PoolRow] })
    expect(out).toMatch(/aria-label="Claim Player p-free"[^>]*data-card-action="acquire" data-acquire="claim"/)
    expect(out).not.toContain('data-card-bid')
    ONE_PLUS(out)
  })
  it('a priority league: one + that claims, no bid', () => {
    const out = body({ waiverType: 'rolling_priority', pool: [{ player_id: 'p-free', state: 'on_waivers', waivers_until: '2099-09-16T07:00:00Z', game_lock: UNLOCKED } as PoolRow] })
    expect(out).toContain('data-acquire="claim"')
    expect(out).not.toContain('data-card-bid')
    ONE_PLUS(out)
  })
  it('a full roster: the + stays live (a press asks for the drop first)', () => {
    const out = body({ rosterSize: 2 })
    expect(out).toContain('data-acquire="add"')
    expect(out).not.toMatch(/disabled=""[^>]*data-card-action="acquire"/)
    expect(out).not.toContain(ROSTER_FULL_COPY)
    ONE_PLUS(out)
  })
  it('a locked free agent: the + disabled, the lock’s reason as its title and shown', () => {
    const out = body({ player: player('p-free'), pool: [{ player_id: 'p-free', state: 'locked_in_game', waivers_until: null, game_lock: LOCKED } as PoolRow] })
    expect(out).toMatch(/<button[^>]*disabled=""[^>]*data-acquire="none"/)
    expect(out).toMatch(/<button[^>]*title="[^"]*game has started[^"]*"[^>]*data-acquire="none"/)
    expect(out).toContain(LOCKED_ADD_TITLE)
    ONE_PLUS(out)
  })
  it('outside the season: the + disabled with the league’s reason', () => {
    const out = body({ leagueStatus: 'drafting' })
    expect(out).toMatch(/disabled=""[^>]*data-acquire="none"/)
    expect(out).toContain(MOVES_BEFORE_SEASON_COPY)
  })
  it('yours: Drop; locked: Drop closed with the reason shown', () => {
    expect(body({ player: player('p-mine') })).toMatch(/data-card-action="drop">Drop<\/button>/)
    const locked = body({ player: player('p-locked') })
    expect(locked).toMatch(/disabled=""[^>]*data-card-action="drop"/)
    expect(locked).toContain(LOCKED_DROP_TITLE)
  })
  it('theirs: Propose trade opens the builder toward his team with him picked; past the deadline, the reason instead', () => {
    const out = body({ player: player('p-theirs') })
    expect(out).toContain('href="/app/leagues/lg/trades?with=them&player=p-theirs"')
    expect(out).toContain('>Propose trade</a>')
    const late = body({ player: player('p-theirs'), tradesClosed: true })
    expect(late).not.toContain('Propose trade')
    expect(late).toContain(TRADE_DEADLINE_PASSED_COPY)
  })
  it('the drop confirmation reads in plain words', () => {
    expect(dropConfirmCopy('Bijan Robinson')).toBe('Bijan Robinson leaves your roster, and other teams can pick him up.')
  })
})

// R1463 — Queue REPLACES the seat's whole Targets list, so an unread queue
// must never pass for an empty one.
// Settled reads: no refetch-on-mount (an SSR render would otherwise show
// the optimistic "fetching" state, not the state under test).
const newQc = () => new QueryClient({ defaultOptions: { queries: { retryOnMount: false, staleTime: Infinity } } })
describe('draft card Queue (R1463)', () => {
  const ctx = { kind: 'draft' as const, leagueId: 'lg1', draftId: 'd1', teamId: 't1' }
  const withClient = (qc: QueryClient) =>
    renderToStaticMarkup(createElement(QueryClientProvider, { client: qc }, createElement(DraftCardActions, { playerId: 'p9', context: ctx })))
  it('a failed queue read keeps Queue off and shows the error with a retry', () => {
    const qc = newQc()
    qc.getQueryCache()
      .build(qc, { queryKey: ['draft-queue', 'd1', 't1'] })
      .setState({ status: 'error', error: new Error('boom'), fetchStatus: 'idle', data: undefined })
    const out = withClient(qc)
    expect(out).toContain('data-card-queue-state="error"')
    expect(out).toMatch(/<button[^>]*disabled=""[^>]*data-card-action="queue"/)
    expect(out).toContain('Couldn’t load your Targets.')
    expect(out).toContain('data-card-action="queue-retry"')
  })
  it('a queue still loading keeps Queue off', () => {
    const out = withClient(newQc())
    expect(out).toContain('data-card-queue-state="loading"')
    expect(out).toMatch(/<button[^>]*disabled=""[^>]*data-card-action="queue"/)
  })
  it('a read queue (even empty) enables Queue', () => {
    const qc = newQc()
    qc.setQueryData(['draft-queue', 'd1', 't1'], [])
    const out = withClient(qc)
    expect(out).not.toContain('data-card-queue-state')
    expect(out).not.toMatch(/<button[^>]*disabled=""[^>]*data-card-action="queue"/)
  })
})
