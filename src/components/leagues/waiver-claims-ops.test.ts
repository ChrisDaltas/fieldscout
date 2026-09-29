/**
 * waiver-claims-ops.test.ts — the waivers UI's copy builders and decisions
 * (M5 task L.D2.13; PROGRESS F425, F432, D414). Pure: no React, no clock.
 */
import { describe, expect, it } from 'vitest'

import type { WaiverClaimView } from '@/lib/leagues/api/waivers-service'
import type { RosterPlayer } from '@/lib/leagues/api/rosters-service'
import { defaultsForTeamCount } from '@/lib/leagues/settings/league-settings'
import { WAIVER_INVALID_REASONS, WAIVER_LOST_REASONS } from '@/lib/leagues/waivers/resolve-waiver-run'
import type { WaiverWindowView } from '@/lib/leagues/waivers/waiver-window-view'

import {
  CLAIM_TITLE,
  LOCKED_CLAIM_TITLE,
  NO_WAIVERS_LINE,
  bidHint,
  canDragOnto,
  claimOnlyAddTitle,
  claimOutcome,
  claimsInRunOrder,
  draggableIds,
  dropPlace,
  faHoldUntil,
  parseBid,
  pickupActions,
  presetPatch,
  toggleRunDay,
  waiverOrderCopy,
  waiverSeatCopy,
  windowLine,
  zoneOptions,
} from './waiver-claims-ops'

function claim(id: string, bid: number, order: number, over: Partial<WaiverClaimView> = {}): WaiverClaimView {
  return {
    id,
    team_id: 't',
    add: { player_id: `p-${id}`, full_name: `Player ${id}`, position: 'WR', nfl_team: 'AAA' },
    drop: null,
    faab_bid: bid,
    claim_order: order,
    status: 'pending',
    result_reason: null,
    process_at: null,
    processed_at: null,
    created_at: '2099-09-10T00:00:00.000Z',
    created_by: 'u',
    cancelled_at: null,
    ...over,
  }
}

const settings = defaultsForTeamCount(8)
const WINDOW: WaiverWindowView = {
  waivers: true,
  free_agency_open: false,
  why: 'awaiting_run',
  next_run_at: '2099-09-16T07:00:00.000Z',
  last_run_at: null,
  last_open_at: null,
  time_zone: 'America/New_York',
  paused: false,
  evaluated_at: '2099-09-15T12:00:00.000Z',
}

describe('F432 — the claims show in the order the run uses; drags only inside an equal-bid group', () => {
  // Stored order disagrees with the bids (a FAAB → priority → FAAB round trip).
  const claims = [claim('a', 5, 1), claim('b', 20, 2), claim('c', 5, 3), claim('d', 20, 4), claim('x', 99, 5, { status: 'won' })]
  it('FAAB: biggest bid first, the stored order between equal bids; settled claims left out', () => {
    expect(claimsInRunOrder(claims, 'faab').map((c) => c.id)).toEqual(['b', 'd', 'a', 'c'])
  })
  it('priority types: the stored order', () => {
    expect(claimsInRunOrder(claims, 'rolling_priority').map((c) => c.id)).toEqual(['a', 'b', 'c', 'd'])
  })
  it('FAAB drags: equal bids only; priority: anywhere; never onto itself', () => {
    const ordered = claimsInRunOrder(claims, 'faab')
    expect(canDragOnto(ordered, 'b', 'd', 'faab')).toBe(true)
    expect(canDragOnto(ordered, 'b', 'a', 'faab')).toBe(false)
    expect(canDragOnto(ordered, 'b', 'a', 'reverse_standings')).toBe(true)
    expect(canDragOnto(ordered, 'b', 'b', 'faab')).toBe(false)
    expect([...draggableIds(ordered, 'faab')].sort()).toEqual(['a', 'b', 'c', 'd'])
    expect([...draggableIds(claimsInRunOrder([claim('a', 5, 1), claim('b', 6, 2)], 'faab'), 'faab')]).toEqual([])
    expect([...draggableIds([claim('solo', 0, 1)], 'rolling_priority')]).toEqual([])
  })
  it('the place sent is the drop target’s place in the STORED order (the move route’s "place N")', () => {
    expect(dropPlace(claims, 'd')).toBe(4)
    expect(dropPlace(claims, 'a')).toBe(1)
    expect(dropPlace(claims, 'x')).toBeNull()
  })
})

describe('claim results in plain words — every stored reason', () => {
  it('won names the price in FAAB only; lost says why', () => {
    expect(claimOutcome(claim('w', 12, 1, { status: 'won' }), 'faab')).toEqual({ label: 'Won', tone: 'positive', detail: 'Won for $12.' })
    expect(claimOutcome(claim('w', 0, 1, { status: 'won' }), 'rolling_priority').detail).not.toMatch(/\$/)
    expect(claimOutcome(claim('l', 3, 1, { status: 'lost', result_reason: 'outbid' }), 'faab').detail).toBe('Another team bid more.')
    expect(claimOutcome(claim('l', 0, 1, { status: 'lost', result_reason: 'lost_on_priority' }), 'rolling_priority').detail).toMatch(/higher waiver priority/)
  })
  it('every invalid reason the resolver and the processor write reads as a sentence — no raw code', () => {
    for (const reason of [...WAIVER_INVALID_REASONS, 'no_waivers', 'seat_vacated', 'manager_left']) {
      const out = claimOutcome(claim('i', 1, 1, { status: 'invalid', result_reason: reason }), 'faab')
      expect(out.label, reason).toBe('Didn’t go through')
      expect(out.detail, reason).toMatch(/^Didn’t go through — /)
      expect(out.detail, reason).not.toContain('_')
    }
    expect(WAIVER_LOST_REASONS).toEqual(['outbid', 'lost_on_priority'])
    // An unknown future reason is shown, humanised, rather than hidden.
    expect(claimOutcome(claim('i', 1, 1, { status: 'invalid', result_reason: 'brand_new_rule' }), 'faab').detail).toBe('Didn’t go through (brand new rule).')
  })
  it('a plain cancel says nothing more; a system cancel says why', () => {
    expect(claimOutcome(claim('c', 1, 1, { status: 'cancelled', result_reason: 'cancelled' }), 'faab')).toEqual({ label: 'Cancelled', tone: 'neutral', detail: null })
    expect(claimOutcome(claim('c', 1, 1, { status: 'cancelled', result_reason: 'seat_vacated' }), 'faab').detail).toMatch(/left the seat/)
  })
})

describe('the window line — one sentence per reason', () => {
  const fmt = (iso: string) => `<${iso}>`
  it('claims only / open / running / before the opening / claims-only league / no waivers', () => {
    expect(windowLine(WINDOW, settings, fmt)).toEqual({
      tone: 'caution',
      text: 'Claims only until the next waiver run, <2099-09-16T07:00:00.000Z>. Put in a claim and it’s settled then.',
    })
    expect(windowLine({ ...WINDOW, free_agency_open: true, why: 'open' }, settings, fmt)?.text).toBe(
      'Free agency is open — pick up any unowned player whose game hasn’t started. Next waiver run: <2099-09-16T07:00:00.000Z>.',
    )
    expect(windowLine({ ...WINDOW, why: 'run_pending' }, settings, fmt)?.text).toMatch(/running now/)
    expect(windowLine({ ...WINDOW, why: 'before_opening_time' }, settings, fmt)?.text).toBe(
      'Claims only — free agency opens Sunday at 6:00 AM (America/New_York). Next waiver run: <2099-09-16T07:00:00.000Z>.',
    )
    expect(windowLine({ ...WINDOW, why: 'claims_only' }, settings, fmt)?.text).toMatch(/Every pickup/)
    expect(windowLine({ ...WINDOW, waivers: false, why: 'no_waivers' }, settings, fmt)?.text).toBe(NO_WAIVERS_LINE)
    expect(windowLine(null, settings, fmt)).toBeNull()
  })
})

describe('F425 — Claim beside Add, as the server’s window allows', () => {
  const free = { availability: { kind: 'free_agent' as const }, lock: { locked: false as const } }
  const onWaivers = { availability: { kind: 'on_waivers' as const, until: '2099-09-16T07:00:00.000Z' }, lock: { locked: false as const } }
  const locked = { availability: { kind: 'free_agent' as const }, lock: { locked: true as const, copy: 'x', until: null } }
  const ctx = (window: WaiverWindowView | null, waiverType = 'faab') => ({ waiverType, window, addTitle: undefined, lockedAddTitle: 'LOCKED', nextRunLocal: 'Wed 3:00 AM' })
  it('claims only: Claim live, Add STILL LIVE with the advisory title naming the run (R1220 — the window is not refreshed on an open page)', () => {
    expect(pickupActions(free, ctx(WINDOW))).toEqual({
      add: { show: true, disabled: false, title: claimOnlyAddTitle('Wed 3:00 AM') },
      claim: { show: true, disabled: false, title: CLAIM_TITLE },
    })
  })
  it('R1219: a database without the claims (pre-149) — no Claim anywhere, Add as before', () => {
    const out = pickupActions(free, { ...ctx(null), claimsLive: false })
    expect(out).toEqual({ add: { show: true, disabled: false, title: undefined }, claim: { show: false } })
    expect(pickupActions(onWaivers, { ...ctx(null), claimsLive: false }).claim).toEqual({ show: false })
  })
  it('free agency open: Add alone', () => {
    expect(pickupActions(free, ctx({ ...WINDOW, free_agency_open: true, why: 'open' }))).toEqual({
      add: { show: true, disabled: false, title: undefined },
      claim: { show: false },
    })
  })
  it('no window (a failed read / older database): both live — the server answers', () => {
    const out = pickupActions(free, ctx(null))
    expect(out.add).toMatchObject({ show: true, disabled: false })
    expect(out.claim).toMatchObject({ show: true, disabled: false })
  })
  it('a dropped player on hold: Claim even while free agency is open', () => {
    expect(pickupActions(onWaivers, ctx({ ...WINDOW, free_agency_open: true, why: 'open' })).claim).toMatchObject({ show: true, disabled: false })
  })
  it('no waivers: never a Claim', () => {
    expect(pickupActions(free, ctx(null, 'none_fcfs')).claim).toEqual({ show: false })
    expect(pickupActions(free, ctx({ ...WINDOW, waivers: false, why: 'no_waivers' })).claim).toEqual({ show: false })
  })
  it('locked 🔒: both disabled with the lock’s reason (the view’s lock, never a clock)', () => {
    expect(pickupActions(locked, ctx(WINDOW))).toEqual({
      add: { show: true, disabled: true, title: 'LOCKED' },
      claim: { show: true, disabled: true, title: LOCKED_CLAIM_TITLE },
    })
  })
})

describe('the bid box, the seat line, the fa_hold chip', () => {
  it('parseBid takes whole dollars only; bidHint is advisory', () => {
    expect(parseBid(' 12 ')).toBe(12)
    expect(parseBid('1.5')).toBeNull()
    expect(parseBid('')).toBeNull()
    expect(parseBid('-3')).toBeNull()
    expect(bidHint(null, 1, 100)).toBe('Enter a whole-dollar bid.')
    expect(bidHint(0, 1, 100)).toBe('The league’s minimum bid is $1.')
    expect(bidHint(101, 1, 100)).toBe('That’s more than your $100 FAAB left.')
    expect(bidHint(100, 1, 100)).toBeNull()
  })
  it('waiverSeatCopy: FAAB left, or the priority, or nothing', () => {
    expect(waiverSeatCopy({ waiver_type: 'faab', faab_budget: 100 }, { faab_balance: 73, waiver_priority: null })).toBe('$73 of $100 FAAB left')
    expect(waiverSeatCopy({ waiver_type: 'rolling_priority', faab_budget: 100 }, { faab_balance: 100, waiver_priority: 3 })).toBe('Waiver priority #3')
    // L.D2.18: no stored order yet — say where it starts, never a number
    expect(waiverSeatCopy({ waiver_type: 'rolling_priority', faab_budget: 100 }, { faab_balance: 100, waiver_priority: null })).toBe(
      'Waiver priority starts from reverse draft order',
    )
    expect(waiverSeatCopy({ waiver_type: 'none_fcfs', faab_budget: 100 }, { faab_balance: 100, waiver_priority: 1 })).toBeNull()
  })
  it('waiverSeatCopy / waiverOrderCopy (L.D2.18, F484): the stored order in plain words, FAAB ties included', () => {
    const faabRolling = { waiver_type: 'faab', faab_budget: 100, faab_tiebreaker: 'rolling_priority' } as const
    // FAAB, rolling tiebreak (the default), order stored ⇒ the tie order after the balance
    expect(waiverSeatCopy(faabRolling, { faab_balance: 73, waiver_priority: 3 }, true)).toBe('$73 of $100 FAAB left · Ties on equal bids: you’re #3')
    expect(waiverSeatCopy(faabRolling, { faab_balance: 73, waiver_priority: 3 })).toBe('$73 of $100 FAAB left · Ties on equal bids: #3')
    // no key stored ⇒ the default (rolling)
    expect(waiverSeatCopy({ waiver_type: 'faab', faab_budget: 100 }, { faab_balance: 73, waiver_priority: 3 })).toBe('$73 of $100 FAAB left · Ties on equal bids: #3')
    // FAAB, order not stored yet (before 163 / before the draft) ⇒ exactly as before
    expect(waiverSeatCopy(faabRolling, { faab_balance: 73, waiver_priority: null }, true)).toBe('$73 of $100 FAAB left')
    // standings-based: say what decides; a stale stored number is never shown
    expect(waiverSeatCopy({ waiver_type: 'faab', faab_budget: 100, faab_tiebreaker: 'reverse_standings' }, { faab_balance: 73, waiver_priority: 2 })).toBe(
      '$73 of $100 FAAB left · Ties on equal bids go by reverse standings',
    )
    expect(waiverSeatCopy({ waiver_type: 'reverse_standings', faab_budget: 100 }, { faab_balance: 100, waiver_priority: 2 })).toBe(
      'Waiver priority goes by reverse standings',
    )
    // a rolling-priority league ignores the tiebreaker key
    expect(waiverOrderCopy({ waiver_type: 'rolling_priority', faab_tiebreaker: 'reverse_standings' }, 5, true)).toBe('Waiver priority #5')
    expect(waiverOrderCopy({ waiver_type: 'none_fcfs' }, 5, true)).toBeNull()
  })
  it('faHoldUntil: a free-agent pickup inside the hold, at the SERVER instant — the boundary exact', () => {
    const p = { acquisition_type: 'free_agent', acquired_at: '2099-09-15T00:00:00.000Z' } as Pick<RosterPlayer, 'acquisition_type' | 'acquired_at'>
    expect(faHoldUntil(p, 24, '2099-09-15T12:00:00.000Z')).toBe('2099-09-16T00:00:00.000Z')
    expect(faHoldUntil(p, 24, '2099-09-15T23:59:59.999Z')).toBe('2099-09-16T00:00:00.000Z')
    expect(faHoldUntil(p, 24, '2099-09-16T00:00:00.000Z')).toBeNull()
    expect(faHoldUntil(p, 0, '2099-09-15T12:00:00.000Z')).toBeNull()
    expect(faHoldUntil({ ...p, acquisition_type: 'draft' }, 24, '2099-09-15T12:00:00.000Z')).toBeNull()
    expect(faHoldUntil(p, 24, null)).toBeNull()
  })
})

describe('the schedule editor’s algebra', () => {
  it('a preset writes its six keys; "no waivers" writes the type; a schedule preset turns waivers back on', () => {
    expect(presetPatch('daily_weekend_free_agency', { waiver_type: 'faab' })).toMatchObject({
      waiver_run_days: ['tue', 'wed', 'thu', 'fri', 'sat'],
      waiver_run_time: '09:00',
      waiver_time_zone: 'America/Los_Angeles',
      free_agency_opens: 'day_and_time',
    })
    expect(presetPatch('no_waivers', { waiver_type: 'faab' })).toMatchObject({ waiver_type: 'none_fcfs' })
    expect(presetPatch('weekly_then_free_agency', { waiver_type: 'none_fcfs' })).toMatchObject({ waiver_type: 'faab', waiver_run_days: ['wed'] })
    expect(presetPatch('custom', { waiver_type: 'faab' })).toBeNull()
  })
  it('run days: canonical order, and the last day cannot be removed', () => {
    expect(toggleRunDay(['wed'], 'mon')).toEqual(['mon', 'wed'])
    expect(toggleRunDay(['mon', 'wed'], 'mon')).toEqual(['wed'])
    expect(toggleRunDay(['wed'], 'wed')).toEqual(['wed'])
  })
  it('the stored zone is always offered', () => {
    expect(zoneOptions('America/Chicago').some((z) => z.value === 'America/Chicago')).toBe(true)
    expect(zoneOptions('Europe/London').at(-1)).toEqual({ value: 'Europe/London', label: 'Europe/London' })
  })
})
