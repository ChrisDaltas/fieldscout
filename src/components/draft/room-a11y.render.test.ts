/**
 * room-a11y.render.test.ts — M7 L.F1.1 (spec §16.3 "Accessible to WCAG 2.1
 * AA (focus states, live-region announcements for picks/clock,
 * color-independent status)"; PROGRESS F55 / F73, D620–D623).
 *
 * Two halves:
 *   - literal goldens for the announcer sentences and the Targets drag
 *     sentences (the falsifiability floor — stored strings, never re-derived);
 *   - `renderToStaticMarkup` pins over the REAL components (the
 *     acting-as.render.test.ts rig): the live regions exist and are mounted
 *     EMPTY (a region that mounts with text announces nothing, and the room
 *     on load is a state, not news), the bid input is described by its
 *     blocker sentence, each auction team is a named group, and the Targets
 *     rows carry dnd-kit's keyboard-sortable semantics.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { draftBidKeys } from '@/hooks/use-draft-bids'
import { draftQueueKeys } from '@/hooks/use-draft-queue'

import { AuctionBlock, type AuctionBlockDraft } from './auction-block'
import { MyQueue } from './my-queue'
import { targetsDragSentence } from './my-queue-ops'
import { RoomAnnouncer } from './room-announcer'
import {
  clockWarningAnnouncement,
  composeTurnAnnouncement,
  crossedClockWarning,
  highBidAnnouncement,
  onClockAnnouncement,
  pickAnnouncement,
} from './room-announcer-ops'

function render(element: ReactElement, seed: (qc: QueryClient) => void = () => {}): string {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, retryOnMount: false } } })
  seed(qc)
  return renderToStaticMarkup(createElement(QueryClientProvider, { client: qc }, element))
}

describe('announcer sentences (goldens)', () => {
  it('a snake pick', () => {
    expect(
      pickAnnouncement({
        pickLabel: '3.07',
        teamName: 'Hadouken Heroes',
        playerName: 'Bijan Robinson',
        position: 'RB',
        price: null,
        isAuction: false,
      }),
    ).toBe('Pick 3.07: Hadouken Heroes takes Bijan Robinson, RB.')
  })

  it('an auction award carries its price', () => {
    expect(
      pickAnnouncement({
        pickLabel: '1.04',
        teamName: 'Team 4',
        playerName: 'Ja’Marr Chase',
        position: 'WR',
        price: 61,
        isAuction: true,
      }),
    ).toBe('Team 4 wins Ja’Marr Chase, WR, for $61.')
  })

  it('a pick with no position on file', () => {
    expect(
      pickAnnouncement({
        pickLabel: '1.01',
        teamName: 'Team 1',
        playerName: 'Somebody',
        position: null,
        price: null,
        isAuction: false,
      }),
    ).toBe('Pick 1.01: Team 1 takes Somebody.')
  })

  it('whose turn — snake and auction, you and them, and the unnamed team stays quiet', () => {
    expect(onClockAnnouncement({ youAreOnClock: true, onClockTeamName: 'X', isAuction: false })).toBe(
      "You're on the clock.",
    )
    expect(
      onClockAnnouncement({ youAreOnClock: false, onClockTeamName: 'Team 9', isAuction: false }),
    ).toBe('On the clock: Team 9.')
    expect(onClockAnnouncement({ youAreOnClock: true, onClockTeamName: null, isAuction: true })).toBe(
      'Your turn to nominate.',
    )
    expect(
      onClockAnnouncement({ youAreOnClock: false, onClockTeamName: 'Team 9', isAuction: true }),
    ).toBe('Team 9 is nominating.')
    expect(onClockAnnouncement({ youAreOnClock: false, onClockTeamName: null, isAuction: false })).toBe(
      '',
    )
  })

  it('a gathered beat says the pick THEN the turn, whichever arrived first', () => {
    expect(
      composeTurnAnnouncement('Pick 1.02: CPU 7 takes Jahmyr Gibbs, RB.', 'On the clock: CPU 6.'),
    ).toBe('Pick 1.02: CPU 7 takes Jahmyr Gibbs, RB. On the clock: CPU 6.')
    expect(composeTurnAnnouncement(null, "You're on the clock.")).toBe("You're on the clock.")
    expect(composeTurnAnnouncement('Team 4 wins Ja’Marr Chase, WR, for $61.', null)).toBe(
      'Team 4 wins Ja’Marr Chase, WR, for $61.',
    )
    expect(composeTurnAnnouncement(null, null)).toBe('')
  })

  it('clock warnings fire on the crossing, at the boundary instants', () => {
    // 30s boundary: 30_001 → 30_000 crosses; 30_000 → 29_999 does not (already crossed).
    expect(crossedClockWarning(30_001, 30_000)).toBe(30_000)
    expect(crossedClockWarning(30_000, 29_999)).toBeNull()
    // 10s boundary.
    expect(crossedClockWarning(10_001, 10_000)).toBe(10_000)
    expect(crossedClockWarning(12_000, 11_500)).toBeNull()
    // A backgrounded tab jumps past both: only the lowest — the stale 30s
    // warning would lie about how much time is left.
    expect(crossedClockWarning(45_000, 8_000)).toBe(10_000)
    // Expiry (0) and the first sample (no previous) announce nothing.
    expect(crossedClockWarning(10_500, 0)).toBeNull()
    expect(crossedClockWarning(null, 9_000)).toBeNull()
    expect(clockWarningAnnouncement(30_000, false)).toBe('30 seconds left on your pick.')
    expect(clockWarningAnnouncement(10_000, true)).toBe('10 seconds left to nominate.')
  })

  it('the high bid — theirs and mine', () => {
    expect(
      highBidAnnouncement({ amount: 14, teamName: 'Team 9', playerName: 'Bid Player', isMine: false }),
    ).toBe('High bid on Bid Player: $14, Team 9.')
    expect(
      highBidAnnouncement({ amount: 15, teamName: 'Team 1', playerName: 'Bid Player', isMine: true }),
    ).toBe('You hold the high bid on Bid Player at $15.')
  })

  it('Targets drag sentences name the player and the place, never an id', () => {
    expect(targetsDragSentence('start', 'Bijan Robinson', 2, 5)).toBe(
      'Picked up Bijan Robinson, Target 2 of 5.',
    )
    expect(targetsDragSentence('over', 'Bijan Robinson', 1, 5)).toBe(
      'Bijan Robinson moved to Target 1 of 5.',
    )
    expect(targetsDragSentence('over', 'Bijan Robinson', null, 5)).toBe(
      'Bijan Robinson is not over a Target.',
    )
    expect(targetsDragSentence('end', 'Bijan Robinson', 1, 5)).toBe(
      'Bijan Robinson dropped at Target 1 of 5.',
    )
    expect(targetsDragSentence('end', 'Bijan Robinson', null, 5)).toBe(
      'Bijan Robinson dropped. Your Targets order is unchanged.',
    )
    expect(targetsDragSentence('cancel', 'Bijan Robinson', 3, 5)).toBe(
      'Move cancelled. Bijan Robinson stays where it was.',
    )
  })
})

describe('the room announcer mounts two EMPTY polite regions', () => {
  it('nothing is announced at mount, even with a pick and a turn on the board', () => {
    const html = render(
      createElement(RoomAnnouncer, {
        latestPick: {
          key: '7:p1',
          pickNumber: 7,
          pickLabel: '1.07',
          teamName: 'Team 1',
          playerName: 'Bid Player',
          position: 'RB',
          price: null,
          isAuction: false,
        },
        latestPickReady: true,
        youAreOnClock: true,
        onClockKey: '8:team-1',
        onClockTeamName: 'Team 1',
        isAuction: false,
        nominationLive: false,
        clock: { status: 'live', current_deadline: null, deadline_remaining_ms: null },
        offsetMs: 0,
      }),
    )
    expect(html).toBe(
      '<p class="sr-only" role="status" data-testid="room-announcer-turn"></p>' +
        '<p class="sr-only" role="status" data-testid="room-announcer-clock"></p>',
    )
  })
})

const DRAFT = 'dr-1'
const T1 = 'team-1'
const T9 = 'team-9'
const TEAMS = [
  { id: T1, name: 'Team 1' },
  { id: T9, name: 'Alpha Team' },
]
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
  nomination_order: [T1, T9],
}
const ROSTER = {
  starting_slots: [{ key: 'rb', label: 'RB', eligible: ['RB'], count: 1 }],
  bench: 2,
  ir_slots: [],
  swap_spots: 0,
}

function auctionBlock(draft: AuctionBlockDraft = BIDDING_DRAFT) {
  return render(
    createElement(AuctionBlock, {
      draft,
      teams: TEAMS,
      picks: [],
      playerById: new Map([
        ['p1', { id: 'p1', full_name: 'Bid Player', position: 'RB', team: 'KC' }],
      ]) as never,
      roster: ROSTER as never,
      myTeamId: T1,
      offsetMs: 0,
      uncontestedBeat: null,
      nomineeId: null,
      onClearNominee: () => {},
      onNominate: () => {},
      onBid: () => {},
      submitting: false,
      actingAs: null,
      actingForTeamId: null,
    }),
    (qc) => qc.setQueryData(draftBidKeys.feed(DRAFT), []),
  )
}

describe('the auction block (F55 L.C3.1 members)', () => {
  it('(a) the high bid is a polite live region, and says who holds it', () => {
    expect(auctionBlock()).toContain(
      '<p class="sr-only" role="status">High bid on Bid Player: $2, Alpha Team.</p>',
    )
  })

  it('(a) my own high bid is told as mine', () => {
    const html = auctionBlock({
      ...BIDDING_DRAFT,
      current_nomination: { player_id: 'p1', high_bid: 5, high_bidder_team_id: T1 },
    })
    expect(html).toContain('You hold the high bid on Bid Player at $5.')
  })

  it('(b) the bid input is described by the sentence beside it', () => {
    const html = auctionBlock()
    const described = /aria-describedby="([^"]+)"/.exec(html)
    expect(described).not.toBeNull()
    const id = described![1]
    expect(html).toContain(`id="${id}"`)
    // The id lands on the help paragraph, not on some other element.
    expect(new RegExp(`<p id="${id}"[^>]*>Minimum \\$3\\.</p>`).test(html)).toBe(true)
  })

  it('(c) every team column is a named group, mine marked as mine', () => {
    const html = auctionBlock()
    expect(html).toContain('role="group" aria-label="Team 1 (you)"')
    expect(html).toContain('role="group" aria-label="Alpha Team"')
  })
})

describe('Targets rows are keyboard-sortable (F73 / WCAG 2.1.1)', () => {
  it('each draggable row is a focusable sortable button wired to the instructions', () => {
    const html = render(
      createElement(MyQueue, {
        leagueId: 'lg-1',
        draftId: DRAFT,
        teamId: T1,
        draftedIds: new Set<string>(),
      }),
      (qc) => {
        qc.setQueryData(draftQueueKeys.queue(DRAFT, T1), [
          { player_id: 'p1', rank: 1 },
          { player_id: 'p2', rank: 2 },
        ])
        qc.setQueryData(
          ['players-by-ids', ['p1', 'p2']],
          [
            { id: 'p1', full_name: 'One Player', position: 'RB', team: 'KC', headshot_url: null, status: null },
            { id: 'p2', full_name: 'Two Player', position: 'WR', team: 'SF', headshot_url: null, status: null },
          ],
        )
      },
    )
    expect(html).toContain('One Player')
    expect((html.match(/aria-roledescription="sortable"/g) ?? []).length).toBe(2)
    expect((html.match(/tabindex="0"/g) ?? []).length).toBeGreaterThanOrEqual(2)
    expect(html).toContain('aria-describedby="DndDescribedBy-')
  })
})
