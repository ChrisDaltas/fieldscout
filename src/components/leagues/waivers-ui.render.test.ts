/**
 * waivers-ui.render.test.ts — the M5 L.D2.13 surfaces over REAL static
 * renders (the `team-page.render.test.ts` rig: `renderToStaticMarkup`, no
 * browser): the claims panel's states, the claim form (FAAB and priority),
 * the players table's Claim beside Add per window, the commissioner's FAAB
 * edit, the schedule rows, the standings FAAB column (PROGRESS F425, F432,
 * D414; spec §16.5.2's Waivers row).
 *
 * Probes: (1) drop `claimsInRunOrder` from the panel (render the stored
 * order) → the F432 order cell reds; (2) re-word a refusal → the verbatim
 * cells red; (3) let the players table ignore the window → the claims-only
 * cell reds.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { PoolPlayer } from '@/components/draft/available-players-ops'
import type { RosterPlayer } from '@/lib/leagues/api/rosters-service'
import type { StandingsRow } from '@/lib/leagues/api/standings-service'
import type { SubmitClaimResult, WaiverClaimView, WaiverClaimsDocument } from '@/lib/leagues/api/waivers-service'
import { defaultsForTeamCount } from '@/lib/leagues/settings/league-settings'
import type { WaiverWindowView } from '@/lib/leagues/waivers/waiver-window-view'

import { ClaimForm } from './claim-dialog'
import { PoolTable } from './players-page'
import type { PoolPlayerRow } from './players-page-ops'
import { GOLDEN_STANDINGS, NAMES } from './standings-schedule.fixtures'
import { StandingsTable } from './standings-table'
import { TeamFaabEditView } from './team-commish-tools'
import { LOCKED_CLAIM_TITLE, WAIVERS_PAUSED_COPY, waiverOrderListView } from './waiver-claims-ops'
import { CLAIMS_EMPTY_COPY, CLAIMS_ERROR_TITLE, WaiverClaimsPanelView } from './waiver-claims-panel'
import { WaiverOrderList } from './waiver-order-list'
import { WaiverScheduleFields } from './waiver-schedule-fields'

function unescapeHtml(html: string): string {
  return html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&')
}
function render(element: React.ReactElement): string {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, retryOnMount: false } } })
  return unescapeHtml(renderToStaticMarkup(createElement(QueryClientProvider, { client }, element)))
}
const noop = () => {}

function claim(id: string, bid: number, order: number, over: Partial<WaiverClaimView> = {}): WaiverClaimView {
  return {
    id,
    team_id: 't',
    add: { player_id: `p-${id}`, full_name: `Player ${id.toUpperCase()}`, position: 'WR', nfl_team: 'AAA' },
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
function doc(claims: WaiverClaimView[], over: Partial<WaiverClaimsDocument> = {}): WaiverClaimsDocument {
  return {
    league_id: 'l',
    team_id: 't',
    status: 'all',
    waiver_type: 'faab',
    faab_budget: 100,
    faab_min_bid: 1,
    faab_balance: 73,
    waiver_priority: null,
    claims,
    ...over,
  }
}
function panel(over: Partial<Parameters<typeof WaiverClaimsPanelView>[0]> = {}): string {
  return render(
    createElement(WaiverClaimsPanelView, {
      doc: doc([]),
      loading: false,
      error: null,
      onRetry: noop,
      nextRunLocal: 'Wed, Sep 16, 3:00 AM',
      pending: false,
      refusal: null,
      onMove: noop,
      onEditBid: noop,
      onCancel: noop,
      ...over,
    }),
  )
}

describe('waiver-claims-panel — every state (§16.5.4)', () => {
  it('loading: a skeleton, no copy', () => {
    const html = panel({ doc: null, loading: true })
    expect(html).toContain('data-skeleton="claims"')
    expect(html).not.toContain(CLAIMS_EMPTY_COPY)
  })
  it('error: named, with Retry — never an empty list', () => {
    const html = panel({ doc: null, error: 'relation "waiver_claims" does not exist' })
    expect(html).toContain('data-claims-error')
    expect(html).toContain(CLAIMS_ERROR_TITLE)
    expect(html).toContain('Retry')
    expect(html).not.toContain(CLAIMS_EMPTY_COPY)
  })
  it('empty: says why and what to do; the FAAB left in the header', () => {
    const html = panel()
    expect(html).toContain(CLAIMS_EMPTY_COPY)
    expect(html).toContain('$73 of $100 FAAB left')
  })
  it('F432: pending claims in the order the RUN uses (bid first), drag handles only inside an equal-bid group, the next run named', () => {
    const html = panel({ doc: doc([claim('a', 5, 1), claim('b', 20, 2), claim('c', 5, 3)]) })
    const ranks = [...html.matchAll(/data-claim="([a-z])" data-claim-rank="(\d)"/g)].map((m) => `${m[2]}:${m[1]}`)
    expect(ranks).toEqual(['1:b', '2:a', '3:c'])
    expect((html.match(/data-claim-drag/g) ?? []).length).toBe(2) // a and c share $5; b is alone at $20
    expect(html).toContain('data-claim-bid="20"')
    expect(html).toContain('Next run: Wed, Sep 16, 3:00 AM.')
    expect(html).toContain('No drop')
  })
  it('priority league: the team’s own order, every row draggable, the priority in the header, no $', () => {
    const html = panel({ doc: doc([claim('a', 0, 2), claim('b', 0, 1)], { waiver_type: 'rolling_priority', waiver_priority: 4 }) })
    const ranks = [...html.matchAll(/data-claim="([a-z])" data-claim-rank="(\d)"/g)].map((m) => `${m[2]}:${m[1]}`)
    expect(ranks).toEqual(['1:b', '2:a'])
    expect((html.match(/data-claim-drag/g) ?? []).length).toBe(2)
    expect(html).toContain('Waiver priority #4')
    expect(html).not.toContain('data-claim-bid')
  })
  it('L.D2.18 (F484): a FAAB league shows the stored tie order beside the balance; a rolling league with none stored says where it starts', () => {
    expect(panel({ doc: doc([], { waiver_priority: 3 }) })).toContain('$73 of $100 FAAB left · Ties on equal bids: you’re #3')
    expect(panel({ doc: doc([], { waiver_priority: 3, faab_tiebreaker: 'reverse_standings' }) })).toContain(
      '$73 of $100 FAAB left · Ties on equal bids: reverse draft order until week 1 is final, then reverse standings',
    )
    const unseeded = panel({ doc: doc([], { waiver_type: 'rolling_priority', waiver_priority: null }) })
    expect(unseeded).toContain('Waiver priority starts from reverse draft order')
    expect(unseeded).not.toContain('Waiver priority #')
  })
  it('results: won / lost / didn’t go through, each with its reason in plain words', () => {
    const html = panel({
      doc: doc([
        claim('w', 12, 1, { status: 'won', drop: { player_id: 'd', full_name: 'Dropped Guy', position: 'RB', nfl_team: 'BBB' } }),
        claim('l', 3, 2, { status: 'lost', result_reason: 'outbid' }),
        claim('i', 3, 3, { status: 'invalid', result_reason: 'drop_locked' }),
      ]),
    })
    expect(html).toContain('data-claims-results')
    expect(html).toContain('Won for $12.')
    expect(html).toContain('Drop Dropped Guy')
    expect(html).toContain('Another team bid more.')
    expect(html).toContain('Didn’t go through — the player you’d drop had already played this week.')
    expect(html).not.toMatch(/drop_locked|outbid</)
  })
  it('a refusal renders VERBATIM', () => {
    const refusal = 'A $5 claim can’t be placed above your $20 claim — claims with bigger bids go first.'
    expect(panel({ doc: doc([claim('a', 5, 1)]), refusal })).toContain(refusal)
  })
})

// ---------------------------------------------------------------------------
// The claim form
// ---------------------------------------------------------------------------

const PLAYER: PoolPlayer = { id: 'fa-1', full_name: 'Free Agent One', position: 'WR', team: 'AAA', status: 'Active' } as PoolPlayer
const ROW: PoolPlayerRow = { player: PLAYER, availability: { kind: 'free_agent' }, lock: { locked: false }, poolState: 'free_agent' }
function rp(over: Partial<RosterPlayer> & Pick<RosterPlayer, 'player_id' | 'full_name'>): RosterPlayer {
  return {
    position: 'RB',
    nfl_team: 'AAA',
    status: 'Active',
    bye_week: null,
    slot_key: 'bn',
    acquisition_type: null,
    acquisition_cost: null,
    ir_placed_week: null,
    ir_lock_until_week: null,
    acquired_at: null,
    pool_state: 'rostered',
    game_lock: { state: 'unlocked', until: null },
    ...over,
  }
}
function form(over: Partial<Parameters<typeof ClaimForm>[0]> = {}): string {
  return render(
    createElement(ClaimForm, {
      row: ROW,
      waiverType: 'faab',
      minBid: 1,
      balance: 73,
      budget: 100,
      roster: [rp({ player_id: 'r1', full_name: 'Roster One' })],
      nextRunLocal: 'Wed, Sep 16, 3:00 AM',
      pending: false,
      refusal: null,
      result: null,
      onSubmit: noop,
      onClose: noop,
      ...over,
    }),
  )
}

describe('the claim form — FAAB bid or priority claim, optional drop', () => {
  it('FAAB: a bid box opening at the minimum, the balance beside it, blind-bid copy, Put in claim', () => {
    const html = form()
    expect(html).toContain('data-claim-form="faab"')
    expect(html).toMatch(/data-claim-bid-input[^>]*value="1"|value="1"[^>]*data-claim-bid-input/)
    expect(html).toContain('$73 of $100 FAAB left')
    expect(html).toContain('Bids are blind')
    expect(html).toContain('Put in claim')
    // Radix Select paints its value client-side; the trigger carries the state.
    expect(html).toContain('data-claim-drop=""')
    expect(html).toContain('Only dropped if the claim goes through.')
  })
  it('priority: no bid box, the priority rule said', () => {
    const html = form({ waiverType: 'reverse_standings' })
    expect(html).toContain('data-claim-form="priority"')
    expect(html).not.toContain('data-claim-bid-input')
    expect(html).toContain('waiver priority')
  })
  it('a refusal renders VERBATIM', () => {
    const refusal = 'waiver_claim_submit: a bid of $90 is more than My Team’s FAAB balance of $73 (§13.2)'
    expect(form({ refusal })).toContain(refusal)
  })
  it('the answer: the claim as the server stored it, and that nothing is spent until the run', () => {
    const result = {
      add_player_name: 'Free Agent One',
      drop_player_name: 'Roster One',
      claim: { faab_bid: 9 },
    } as unknown as SubmitClaimResult
    const html = form({ result })
    expect(html).toContain('Claim in for Free Agent One — $9')
    expect(html).toContain('If it goes through, Roster One is dropped.')
    expect(html).toContain('Settles at the next waiver run: Wed, Sep 16, 3:00 AM.')
    expect(html).toContain('Nothing is spent until then')
  })
})

// ---------------------------------------------------------------------------
// The players table — Claim beside Add as the window allows (F425)
// ---------------------------------------------------------------------------

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
function table(window: WaiverWindowView | null, rows: PoolPlayerRow[] = [ROW], over: Partial<Parameters<typeof PoolTable>[0]> = {}): string {
  return render(
    createElement(PoolTable, {
      leagueId: 'l',
      rows,
      scope: 'all',
      hadSearch: false,
      canAct: true,
      intent: { add: null, drop: null },
      leagueTimeZone: null,
      waiverType: 'faab',
      waiverWindow: window,
      nextRunLocal: 'Wed 3:00 AM',
      onAdd: noop,
      onDrop: noop,
      ...over,
    }),
  )
}

describe('the players table per window', () => {
  it('claims only: a live Claim first, and a LIVE Add whose title names the run (R1220 — the server’s refusal is the rule)', () => {
    const html = table(WINDOW)
    expect(html).toMatch(/data-action="claim">Claim<\/button><button[^>]*title="Claims only right now[^"]*Wed 3:00 AM[^"]*"[^>]*data-action="add"/)
    expect(html).not.toMatch(/disabled=""/)
  })
  it('R1219: no claims on this database (pre-149) — no Claim, Add live', () => {
    const html = table(null, [ROW], { claimsLive: false })
    expect(html).not.toContain('data-action="claim"')
    expect(html).toContain('data-action="add"')
    expect(html).not.toMatch(/disabled=""/)
  })
  it('free agency open: Add alone', () => {
    const html = table({ ...WINDOW, free_agency_open: true, why: 'open' })
    expect(html).toContain('data-action="add"')
    expect(html).not.toContain('data-action="claim"')
    expect(html).not.toMatch(/disabled=""/)
  })
  it('no window: both live (the server answers)', () => {
    const html = table(null)
    expect(html).toContain('data-action="claim"')
    expect(html).toContain('data-action="add"')
    expect(html).not.toMatch(/disabled=""/)
  })
  it('no waivers: no Claim anywhere', () => {
    expect(table(null, [ROW], { waiverType: 'none_fcfs' })).not.toContain('data-action="claim"')
  })
  it('locked 🔒 row: Claim disabled with the lock’s reason', () => {
    const html = table(WINDOW, [{ ...ROW, lock: { locked: true, copy: 'locked — game started', until: '2099-09-16T03:00:00.000Z' } }])
    expect(html).toContain('🔒 locked')
    expect(html).toMatch(new RegExp(`disabled=""[^>]*title="${LOCKED_CLAIM_TITLE}"[^>]*data-action="claim"`))
  })
  it('the fa_hold chip on my fresh pickup — the stored pickup + hold against the server instant', () => {
    const mine: PoolPlayerRow = {
      player: { ...PLAYER, id: 'mine' } as PoolPlayer,
      availability: { kind: 'rostered', teamId: 't', teamName: 'Mine', mine: true },
      lock: { locked: false },
      poolState: 'rostered',
      roster: rp({ player_id: 'mine', full_name: 'Mine', acquisition_type: 'free_agent', acquired_at: '2099-09-15T00:00:00.000Z' }),
    }
    const held = table(WINDOW, [mine], { faHoldHours: 24 })
    expect(held).toContain('data-fa-hold="2099-09-16T00:00:00.000Z"')
    expect(held).toContain('Hold until')
    expect(table({ ...WINDOW, evaluated_at: '2099-09-16T00:00:00.000Z' }, [mine], { faHoldHours: 24 })).not.toContain('data-fa-hold')
  })
})

// ---------------------------------------------------------------------------
// The commissioner's FAAB edit, the schedule rows, the standings column
// ---------------------------------------------------------------------------

describe('the commissioner’s FAAB edit (override mode)', () => {
  const view = (over: Partial<Parameters<typeof TeamFaabEditView>[0]> = {}) =>
    render(createElement(TeamFaabEditView, { teamName: 'Bravo', balance: 40, pending: false, outcome: null, refusal: null, onSave: noop, ...over }))
  it('the current balance and the box, no reason field', () => {
    const html = view()
    expect(html).toContain('Bravo’s FAAB balance')
    expect(html).toContain('Now $40.')
    expect(html).toContain('Set balance')
    expect(html).not.toMatch(/reason/i)
  })
  it('the answer read out — a change, a no-op, pending bids above the new balance; a refusal verbatim', () => {
    expect(view({ outcome: { no_changes: false, faab_balance: 25, previous_balance: 40, pending_bids_above_balance: 2 } })).toContain(
      'Balance set to $25 (was $40). 2 pending bids are now above it — they fail at the run unless changed.',
    )
    expect(view({ outcome: { no_changes: true, faab_balance: 40, previous_balance: 40, pending_bids_above_balance: 0 } })).toContain(
      'No change — the balance is already $40.',
    )
    expect(view({ refusal: 'Only the league’s commissioner can edit FAAB balances.' })).toContain('Only the league’s commissioner can edit FAAB balances.')
  })
})

describe('the schedule rows — the preset pick (wizard) and the full schedule (settings)', () => {
  const s = defaultsForTeamCount(8)
  it('settings: the preset, the run days pressed, the time, the zone, when free agency opens', () => {
    const html = render(createElement(WaiverScheduleFields, { s, onSettings: noop }))
    // The stored schedule said in words (the one describer) under the preset pick.
    expect(html).toContain('Waivers run Wednesday at 3:00 AM (America/New_York)')
    expect(html).toContain('data-run-days="wed"')
    expect(html).toMatch(/aria-pressed="true"[^>]*>Wed</)
    expect(html).toMatch(/aria-pressed="false"[^>]*>Mon</)
    expect(html).toMatch(/type="time"[^>]*value="03:00"/)
    expect(html).toContain('It always closes when the week’s last game ends.')
  })
  it('the day-and-time opening shows its own day and time', () => {
    const html = render(createElement(WaiverScheduleFields, { s: { ...s, free_agency_opens: 'day_and_time' }, onSettings: noop }))
    expect(html).toMatch(/type="time"[^>]*value="06:00"/)
  })
  it('the wizard: the preset pick only; no-waivers leagues show no schedule detail', () => {
    expect(render(createElement(WaiverScheduleFields, { s, onSettings: noop, detail: false }))).not.toContain('data-run-days')
    expect(render(createElement(WaiverScheduleFields, { s: { ...s, waiver_type: 'none_fcfs' }, onSettings: noop }))).not.toContain('data-run-days')
  })
})

describe('standings: a FAAB league shows each team’s balance', () => {
  const docWithFaab = { ...GOLDEN_STANDINGS, standings: GOLDEN_STANDINGS.standings.map((r, i) => ({ ...r, faab_balance: i === 0 ? 55 : null })) }
  const table2 = (waiver_type: string) =>
    render(
      createElement(StandingsTable, {
        doc: docWithFaab,
        settings: { median_game: false, second_opponent: false, waiver_type },
        teamNames: NAMES,
        highlightTeamId: null,
      }),
    )
  it('FAAB: the column, $ amounts, — for an unset balance', () => {
    const html = table2('faab')
    expect(html).toContain('>FAAB<')
    expect(html).toContain('data-faab="55">$55<')
    expect(html).toMatch(/data-faab="">—</)
  })
  it('priority leagues: no FAAB column', () => {
    expect(table2('rolling_priority')).not.toContain('>FAAB<')
  })
})

describe('standings: the whole league’s waiver order (L.D3.15, F494)', () => {
  // GOLDEN_STANDINGS' rank order is Alpha, Bravo, Charlie, Delta; the STORED
  // order below is Charlie, Alpha, Delta, Bravo — the list must follow it.
  const stored = [3, 4, 1, 2]
  const rows: StandingsRow[] = GOLDEN_STANDINGS.standings.map((r, i) => ({ ...r, waiver_priority: stored[i]! }))
  const list = (settings: { waiver_type: string; faab_tiebreaker?: string }, teams: readonly StandingsRow[] = rows, mine: string | null = 't2') =>
    render(createElement(WaiverOrderList, { view: waiverOrderListView(settings, teams, mine), leagueId: 'league-1' }))
  const order = (html: string) => [...html.matchAll(/data-waiver-order-team="(t\d)" data-waiver-priority="(\d*)"/g)].map((m) => `${m[2]}:${m[1]}`)
  it('rolling priority: every team, #1 first by the stored number, each a link to its page; the viewer’s row filled, never lifted', () => {
    const html = list({ waiver_type: 'rolling_priority' })
    expect(html).toContain('data-waiver-order="order"')
    expect(html).toContain('>Waiver order<')
    expect(order(html)).toEqual(['1:t3', '2:t4', '3:t1', '4:t2'])
    expect(html).toContain('>#1<')
    expect(html).toContain('href="/app/leagues/league-1/team/t3"')
    const mine = html.match(/<li[^>]*data-waiver-order-team="t2"[^>]*>/)![0]
    expect(mine).toContain('data-mine="true"')
    expect(mine).toContain('bg-accent-soft')
    expect(mine).not.toMatch(/shadow/)
    expect(html.match(/<li[^>]*data-waiver-order-team="t1"[^>]*>/)![0]).not.toContain('data-mine')
    expect(html).toContain('>You<')
  })
  it('FAAB with the rolling tiebreak: the same stored order, titled as the tie order for equal bids', () => {
    const html = list({ waiver_type: 'faab', faab_tiebreaker: 'rolling_priority' })
    expect(html).toContain('>Tie order for equal bids<')
    expect(html).toContain('When bids are equal, the team higher on this list gets him')
    expect(order(html)).toEqual(['1:t3', '2:t4', '3:t1', '4:t2'])
  })
  it('standings-based: the rule in words, no list and no stale number', () => {
    const html = list({ waiver_type: 'faab', faab_tiebreaker: 'reverse_standings' })
    expect(html).toContain('data-waiver-order="rule"')
    expect(html).toContain('Ties on equal bids: reverse draft order until week 1 is final, then reverse standings.')
    expect(html).not.toContain('data-waiver-order-team')
    expect(html).not.toMatch(/>#\d</)
    expect(list({ waiver_type: 'reverse_standings' })).toContain('Waiver priority: reverse draft order until week 1 is final, then reverse standings.')
  })
  it('no stored order: the plain fallback copy', () => {
    const none = GOLDEN_STANDINGS.standings
    const rolling = list({ waiver_type: 'rolling_priority' }, none)
    expect(rolling).toContain('data-waiver-order="fallback"')
    expect(rolling).toContain('Waiver priority starts from reverse draft order.')
    expect(rolling).not.toContain('data-waiver-order-team')
    expect(list({ waiver_type: 'faab' }, none)).toContain('Ties on equal bids start from reverse draft order.')
  })
  it('no waivers: nothing rendered', () => {
    expect(list({ waiver_type: 'none_fcfs' })).toBe('')
  })
})

describe('the waivers files: single theme, no clock, resting shadows only on true overlays', () => {
  const files = [
    'src/components/leagues/waiver-claims-panel.tsx',
    'src/components/leagues/waiver-claims-ops.ts',
    'src/components/leagues/claim-dialog.tsx',
    'src/components/leagues/waiver-schedule-fields.tsx',
    'src/components/leagues/waiver-order-list.tsx',
  ]
  const code = (f: string) =>
    readFileSync(path.resolve(process.cwd(), f), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .filter((l) => !l.trim().startsWith('//'))
      .join('\n')
  it('no dark:, no next-themes, no clock read', () => {
    for (const f of files) {
      const src = code(f)
      expect(src, f).not.toMatch(/\bdark:/)
      expect(src, f).not.toContain('next-themes')
      expect(src, f).not.toMatch(/Date\.now\(|new Date\(\)/)
    }
  })
  it('the only resting shadow is the drag ghost (`isDragging`)', () => {
    for (const f of files) {
      for (const m of code(f).matchAll(/(?<![\w-])(?<!:)shadow-hard-[\w-]+/g)) {
        expect(code(f).slice(Math.max(0, m.index - 30), m.index), `${f}: ${m[0]}`).toMatch(/isDragging && '$/)
      }
    }
  })
  it('the paused banner copy is plain words', () => {
    expect(WAIVERS_PAUSED_COPY).not.toMatch(/\b[QEFD]\d+\b|system_flags/)
  })
})
