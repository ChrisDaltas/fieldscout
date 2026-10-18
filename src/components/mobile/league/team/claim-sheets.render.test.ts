/**
 * Editing a pending claim on the phone (gap list §3 #13) over real renders:
 * the Edit claim form (the bid stepper, the drop picker — "No drop" only
 * while the roster has room, locked players left out, a drop who has left
 * named — Save only for a real change, a refusal verbatim), the Claim
 * order list's arrows (FAAB: only among equal bids), and the Team tab's
 * Pending claims with Edit and the Claim order door.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { waiverClaimKeys } from '@/hooks/use-waiver-claims'
import type { RosterPlayer } from '@/lib/leagues/api/rosters-service'
import type { WaiverClaimView, WaiverClaimsDocument } from '@/lib/leagues/api/waivers-service'

import { claimOrderRows } from './claim-edit-ops'
import { ClaimEditForm, ClaimOrderList } from './claim-sheets'
import { PendingClaims } from './moves'

vi.mock('next/navigation', () => ({
  usePathname: () => '/app/leagues/league-1/team/t1',
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

const LEAGUE = 'league-1'
const unescape = (html: string) => html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&')
const html = (el: ReactElement) => unescape(renderToStaticMarkup(el))

function rp(id: string, full_name: string, position = 'WR', locked = false): RosterPlayer {
  return {
    player_id: id,
    full_name,
    position,
    nfl_team: 'KC',
    status: 'Active',
    bye_week: null,
    slot_key: null,
    acquisition_type: null,
    acquisition_cost: null,
    ir_placed_week: null,
    ir_lock_until_week: null,
    acquired_at: null,
    pool_state: 'rostered',
    game_lock: locked ? { state: 'locked_release_unrecorded', until: null } : { state: 'unlocked', until: null },
  }
}

const P = (id: string, name: string, pos = 'WR', team = 'LAR') => ({ player_id: id, full_name: name, position: pos, nfl_team: team })

function claim(id: string, over: Partial<WaiverClaimView> = {}): WaiverClaimView {
  return {
    id,
    team_id: 't1',
    add: P(`add-${id}`, 'Puka Nacua'),
    drop: null,
    faab_bid: 7,
    claim_order: 1,
    status: 'pending',
    result_reason: null,
    process_at: null,
    processed_at: null,
    created_at: '2099-10-10T10:00:00.000Z',
    created_by: 'u',
    cancelled_at: null,
    ...over,
  }
}

const ROSTER = [rp('a', 'Amon-Ra St. Brown'), rp('b', 'Jordan Love', 'QB', true), rp('c', 'Dalton Kincaid', 'TE')]

function form(over: Partial<Parameters<typeof ClaimEditForm>[0]> = {}) {
  return html(
    createElement(ClaimEditForm, {
      claim: claim('c1'),
      bounds: { min: 0, max: 60 },
      roster: ROSTER,
      rosterSize: 17,
      identity: null,
      pending: false,
      refusal: null,
      onSave: () => {},
      onClose: () => {},
      ...over,
    }),
  )
}

const saveButton = (h: string) => h.match(/<button[^>]*>Save<\/button>/)?.[0] ?? ''

describe('Edit claim — the bid and the drop', () => {
  it('shows the claimed player (not editable), the bid stepper and the drop picker with No drop picked', () => {
    const h = form()
    expect(h).toContain('data-claim-head="add-c1"')
    expect(h).toContain('Puka Nacua')
    expect(h).toContain('data-move-bid')
    expect(h).toContain('>$7<')
    expect(h).toContain('Bids from $0 to $60 (your FAAB left).')
    expect(h).toContain('Drop (optional)')
    expect(h).toContain('Only dropped if the claim goes through.')
    expect(h).toMatch(/aria-checked="true"[^>]*data-drop-choice="none"/)
    // Nothing changed yet: Save is off.
    expect(saveButton(h)).toContain('disabled=""')
  })

  it('a locked player is never offered as the drop', () => {
    const h = form()
    expect(h).toContain('data-drop-choice="a"')
    expect(h).toContain('data-drop-choice="c"')
    expect(h).not.toContain('data-drop-choice="b"')
  })

  it('the claim’s current drop is picked — and kept on offer even once his game started', () => {
    const h = form({ claim: claim('c1', { drop: P('b', 'Jordan Love', 'QB', 'GB') }) })
    expect(h).toMatch(/aria-checked="true"[^>]*data-drop-choice="b"/)
    expect(h).toMatch(/aria-checked="false"[^>]*data-drop-choice="none"/)
  })

  it('a full roster: no "No drop", the roster-full line, and Save waits for a pick', () => {
    const h = form({ rosterSize: 3, claim: claim('c1', { drop: P('gone', 'Tyler Allgeier', 'RB', 'ATL') }) })
    expect(h).not.toContain('data-drop-choice="none"')
    expect(h).toContain('Your roster is full — pick a player to drop.')
    // His drop has left the roster: named, and nothing picked.
    expect(h).toContain('Tyler Allgeier isn’t on your roster any more.')
    expect(h).not.toMatch(/aria-checked="true"/)
    expect(saveButton(h)).toContain('disabled=""')
  })

  it('another claim for the same player already drops X (or nothing): neither is offered', () => {
    const h = form({ claim: claim('c1', { drop: P('a', 'Amon-Ra St. Brown') }), taken: new Set<string | null>(['c', null]) })
    expect(h).not.toContain('data-drop-choice="none"')
    expect(h).not.toContain('data-drop-choice="c"')
    expect(h).toMatch(/aria-checked="true"[^>]*data-drop-choice="a"/)
  })

  it('a priority league: no bid at all', () => {
    const h = form({ bounds: null, claim: claim('c1', { faab_bid: 0 }) })
    expect(h).not.toContain('data-move-bid')
    expect(h).toContain('data-drop-picker')
  })

  it('a refusal renders verbatim; while saving the buttons wait', () => {
    expect(form({ refusal: new Error('waiver_claim_edit: a bid of $70 is more than Dev Fixture FC’s FAAB balance of $60') })).toContain(
      'a bid of $70 is more than Dev Fixture FC’s FAAB balance of $60',
    )
    const h = form({ pending: true })
    expect(h).toContain('Saving…')
    expect(h).toMatch(/<button[^>]*disabled=""[^>]*>Close<\/button>/)
  })
})

describe('Claim order — the arrows', () => {
  const doc = {
    waiver_type: 'faab',
    claims: [
      claim('rice', { add: P('r', 'Rashee Rice', 'WR', 'KC'), faab_bid: 12, claim_order: 1, drop: P('a', 'Amon-Ra St. Brown') }),
      claim('nacua', { add: P('n', 'Puka Nacua'), faab_bid: 7, claim_order: 2 }),
      claim('davis', { add: P('d', 'Ray Davis', 'RB', 'BUF'), faab_bid: 7, claim_order: 3 }),
    ],
  }

  function list(rows = claimOrderRows(doc), faab = true) {
    return html(createElement(ClaimOrderList, { rows, faab, playerById: new Map(), pending: false, refusal: null, onMove: () => {}, onDone: () => {} }))
  }

  const arrow = (h: string, id: string, dir: 'up' | 'down') => {
    const row = h.slice(h.indexOf(`data-claim-order-row="${id}"`))
    return row.match(new RegExp(`<button[^>]*data-claim-move="${dir}"[^>]*>`))?.[0] ?? ''
  }

  it('numbers the claims in the order the run tries them, with each one’s bid and drop', () => {
    const h = list()
    const order = ['rice', 'nacua', 'davis'].map((id) => h.indexOf(`data-claim-order-row="${id}"`))
    expect(order).toEqual([...order].sort((x, y) => x - y))
    expect(h).toContain('data-claim-rank="1"')
    expect(h).toContain('R. Rice')
    expect(h).toContain('$12 bid · drop A. St. Brown')
    expect(h).toContain('$7 bid · no drop')
  })

  it('FAAB: only the equal bids may swap — the top bid’s arrows are off', () => {
    const h = list()
    expect(arrow(h, 'rice', 'up')).toContain('disabled=""')
    expect(arrow(h, 'rice', 'down')).toContain('disabled=""')
    expect(arrow(h, 'nacua', 'up')).toContain('disabled=""')
    expect(arrow(h, 'nacua', 'down')).not.toContain('disabled=""')
    expect(arrow(h, 'davis', 'up')).not.toContain('disabled=""')
    expect(arrow(h, 'davis', 'down')).toContain('disabled=""')
    expect(arrow(h, 'davis', 'up')).toContain('aria-label="Move Ray Davis up"')
  })

  it('a refusal renders verbatim', () => {
    const h = html(
      createElement(ClaimOrderList, {
        rows: claimOrderRows(doc),
        faab: true,
        playerById: new Map(),
        pending: false,
        refusal: new Error('That claim was settled or cancelled a moment ago — refresh your claims.'),
        onMove: () => {},
        onDone: () => {},
      }),
    )
    expect(h).toContain('role="alert"')
    expect(h).toContain('That claim was settled or cancelled a moment ago — refresh your claims.')
  })
})

describe('Team tab — Pending claims with Edit and the Claim order door', () => {
  function doc(claims: WaiverClaimView[]): WaiverClaimsDocument {
    return { league_id: LEAGUE, team_id: 't1', status: 'pending', waiver_type: 'faab', faab_budget: 100, faab_min_bid: 0, faab_balance: 60, waiver_priority: 1, claims }
  }
  function team(claims: WaiverClaimView[]) {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    qc.setQueryData(waiverClaimKeys.team(LEAGUE, null, 'pending'), doc(claims))
    return html(createElement(QueryClientProvider, { client: qc }, createElement(PendingClaims, { leagueId: LEAGUE, claimsLive: true })))
  }

  it('each claim has Edit beside Cancel; one claim has no order to set', () => {
    const h = team([claim('c1')])
    expect(h).toContain('aria-label="Edit the claim for Puka Nacua"')
    expect(h).toContain('>Cancel<')
    expect(h).not.toContain('data-claim-order-door')
  })

  it('two or more: the Claim order door, and the claims in the order the run tries them', () => {
    const h = team([
      claim('low', { add: P('l', 'Ray Davis', 'RB', 'BUF'), faab_bid: 3, claim_order: 1 }),
      claim('high', { add: P('h', 'Rashee Rice', 'WR', 'KC'), faab_bid: 12, claim_order: 2 }),
    ])
    expect(h).toContain('data-claim-order-door')
    expect(h.indexOf('data-pending-claim="high"')).toBeLessThan(h.indexOf('data-pending-claim="low"'))
  })
})
