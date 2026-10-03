/**
 * acting-as.render.test.ts — F524's render proofs (PROGRESS D474): the
 * commissioner's "acting as" picker shows in the auction block's bid row and
 * the Targets panel ONLY when the room hands it a control (a commissioner on
 * a real league draft — `canActForTeams`), and the words follow the team he
 * acts for ("Bid $3 for Team 4", "Team 4’s Targets"). Everyone else sees the
 * room exactly as before — no picker, "Your bid", "My Targets". The pure
 * derivations are pinned beside them.
 *
 * The rig: `renderToStaticMarkup` over the REAL components with the React
 * Query cache pre-seeded (the queue, the bid feed, the player identities).
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { draftBidKeys } from '@/hooks/use-draft-bids'
import { draftQueueKeys } from '@/hooks/use-draft-queue'

import type { ActingAsControl } from './acting-as-picker'
import {
  MY_TEAM_VALUE,
  actingAsOptions,
  actingTeamId,
  bidButtonLabel,
  canActForTeams,
  isActingForAnother,
  pickedFromValue,
  pickerValue,
  targetsTitle,
} from './acting-as-ops'
import { AuctionBlock, type AuctionBlockDraft } from './auction-block'
import { MyQueue } from './my-queue'

const LEAGUE = 'lg-1'
const DRAFT = 'dr-1'
const T1 = 'team-1'
const T4 = 'team-4'
const T9 = 'team-9'
const TEAMS = [
  { id: T1, name: 'Team 1' },
  { id: T9, name: 'Alpha Team' },
  { id: T4, name: 'Team 4' },
]

function render(element: ReactElement, seed: (qc: QueryClient) => void = () => {}): string {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, retryOnMount: false } } })
  seed(qc)
  return renderToStaticMarkup(createElement(QueryClientProvider, { client: qc }, element))
}

function control(picked: string | null, myTeamId: string | null = T1): ActingAsControl {
  return { teams: TEAMS, myTeamId, picked, onPick: () => {} }
}

const BIDDING_DRAFT: AuctionBlockDraft = {
  id: DRAFT,
  status: 'live',
  config: { auction_budget: 200 },
  total_rounds: 15,
  current_pick_number: 4,
  current_deadline: null,
  on_clock_team_id: T9,
  current_nomination: { player_id: 'p1', high_bid: 2, high_bidder_team_id: T9 },
  budget_adjustments: {},
  nomination_order: [T1, T9, T4],
}
const ROSTER = {
  starting_slots: [{ key: 'rb', label: 'RB', eligible: ['RB'], count: 1 }],
  bench: 2,
  ir_slots: [],
  swap_spots: 0,
}

function auctionBlock(props: { actingAs: ActingAsControl | null; actingForTeamId: string | null; draft?: AuctionBlockDraft }) {
  return render(
    createElement(AuctionBlock, {
      draft: props.draft ?? BIDDING_DRAFT,
      teams: TEAMS,
      picks: [],
      playerById: new Map([['p1', { id: 'p1', full_name: 'Bid Player', position: 'RB', team: 'KC' }]]) as never,
      roster: ROSTER as never,
      myTeamId: T1,
      offsetMs: 0,
      uncontestedBeat: null,
      nomineeId: null,
      onClearNominee: () => {},
      onNominate: () => {},
      onBid: () => {},
      submitting: false,
      actingAs: props.actingAs,
      actingForTeamId: props.actingForTeamId,
    }),
    (qc) => qc.setQueryData(draftBidKeys.feed(DRAFT), []),
  )
}

function queuePanel(props: { teamId: string; actingAs: ActingAsControl | null; actingForName: string | null }) {
  return render(
    createElement(MyQueue, {
      leagueId: LEAGUE,
      draftId: DRAFT,
      teamId: props.teamId,
      draftedIds: new Set<string>(),
      actingAs: props.actingAs,
      actingForName: props.actingForName,
    }),
    (qc) => qc.setQueryData(draftQueueKeys.queue(DRAFT, props.teamId), []),
  )
}

describe('the auction block (F524)', () => {
  it('a commissioner acting for Team 4 sees the "Bid for" picker and a button that names the team', () => {
    const html = auctionBlock({ actingAs: control(T4), actingForTeamId: T4 })
    expect(html).toContain('aria-label="Bid for"')
    expect(html).toContain('Team 4’s bid')
    expect(html).toContain('Bid $3 for Team 4')
  })

  it('a commissioner on his own team sees the picker and his own bid', () => {
    const html = auctionBlock({ actingAs: control(null), actingForTeamId: null })
    expect(html).toContain('aria-label="Bid for"')
    expect(html).toContain('Your bid')
    expect(html).toContain('Bid $3<')
  })

  it('a manager sees no picker — the room as before', () => {
    const html = auctionBlock({ actingAs: null, actingForTeamId: null })
    expect(html).not.toContain('Bid for')
    expect(html).toContain('Your bid')
  })

  it('while nominating there is no picker (the bid box is his own seat’s turn)', () => {
    const html = auctionBlock({
      actingAs: control(T4),
      actingForTeamId: T4,
      draft: { ...BIDDING_DRAFT, current_nomination: null, on_clock_team_id: T1 },
    })
    expect(html).not.toContain('Bid for')
    expect(html).not.toContain('for Team 4')
  })
})

describe('the Targets panel (F524)', () => {
  it('acting for Team 4: the title, the picker and the empty copy name the team', () => {
    const html = queuePanel({ teamId: T4, actingAs: control(T4), actingForName: 'Team 4' })
    expect(html).toContain('Team 4’s Targets')
    expect(html).toContain('aria-label="Targets for"')
    expect(html).toContain('Team 4 has no Targets yet.')
  })

  it('a manager: "My Targets", no picker', () => {
    const html = queuePanel({ teamId: T1, actingAs: null, actingForName: null })
    expect(html).toContain('My Targets')
    expect(html).not.toContain('Targets for')
  })
})

describe('the pure derivations', () => {
  it('who sees it: a commissioner or co-commissioner on a real league draft only', () => {
    expect(canActForTeams({ isMock: false, leagueId: LEAGUE, myRole: 'commissioner' })).toBe(true)
    expect(canActForTeams({ isMock: false, leagueId: LEAGUE, myRole: 'co_commissioner' })).toBe(true)
    expect(canActForTeams({ isMock: false, leagueId: LEAGUE, myRole: 'manager' })).toBe(false)
    expect(canActForTeams({ isMock: true, leagueId: LEAGUE, myRole: 'commissioner' })).toBe(false)
    expect(canActForTeams({ isMock: false, leagueId: null, myRole: 'commissioner' })).toBe(false)
  })

  it('options: his own team first, then the others by name; a seatless commissioner gets only the others', () => {
    expect(actingAsOptions(TEAMS, T1)).toEqual([
      { value: MY_TEAM_VALUE, label: 'My team (Team 1)' },
      { value: T9, label: 'Alpha Team' },
      { value: T4, label: 'Team 4' },
    ])
    expect(actingAsOptions(TEAMS, null).map((o) => o.value)).toEqual([T9, T1, T4])
  })

  it('the acting team and whether it is another team', () => {
    expect(actingTeamId(null, T1)).toBe(T1)
    expect(actingTeamId(T4, T1)).toBe(T4)
    expect(isActingForAnother(null, T1)).toBe(false)
    expect(isActingForAnother(T1, T1)).toBe(false)
    expect(isActingForAnother(T4, T1)).toBe(true)
    expect(isActingForAnother(T4, null)).toBe(true)
  })

  it('the Select value round-trips', () => {
    expect(pickerValue(null, T1)).toBe(MY_TEAM_VALUE)
    expect(pickerValue(T1, T1)).toBe(MY_TEAM_VALUE)
    expect(pickerValue(T4, T1)).toBe(T4)
    expect(pickerValue(null, null)).toBeUndefined()
    expect(pickedFromValue(MY_TEAM_VALUE)).toBeNull()
    expect(pickedFromValue(T4)).toBe(T4)
  })

  it('the words', () => {
    expect(targetsTitle(null)).toBe('My Targets')
    expect(targetsTitle('Team 4')).toBe('Team 4’s Targets')
    expect(bidButtonLabel(5, null)).toBe('Bid $5')
    expect(bidButtonLabel(5, 'Team 4')).toBe('Bid $5 for Team 4')
  })
})
