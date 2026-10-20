/**
 * Mock drafts on the phone (gap list §4 item 110): `/app/mocks` and
 * `/app/mocks/[id]/report` draw their own FieldScout Mobile screens — the
 * 52px page bar over Home's Mock draft card and the practice rows, and the
 * report as League › Draft results over a practice draft — in `m-*` tokens
 * so the phone's dark mode follows, instead of the borrowed desktop layout.
 * Desktop keeps its pages, on the same reads.
 *
 * The pure helpers first, then the screens rendered statically over a
 * seeded query cache (effects don't run).
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  usePathname: () => '/app/mocks',
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/lib/supabase/client', () => ({
  createBrowserClient: () => ({
    auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }) },
    from: () => ({}),
    channel: () => ({ on: () => ({}), subscribe: () => ({}) }),
    removeChannel: () => {},
  }),
}))
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ user: { id: 'user-me' }, profile: { username: 'dalton' }, isLoading: false }),
}))
const flags = vi.hoisted(() => ({ leagues: true, mockDrafts: true, personas: false, messages: false, weeklyRanks: true, startOrSit: true }))
vi.mock('@/lib/feature-flags', () => ({ featureFlags: flags }))

import { launchDisabledReason, MOCK_CAP_NOTE, MOCK_LEAGUE_HIDDEN_NOTE, MOCK_PAUSED_EXPIRY_NOTE } from '@/components/draft/mock-launcher-ops'
import { MOCK_LINE } from '@/components/mobile/league/league/draft-results-ops'
import { draftKeys, type DraftPickSummary } from '@/hooks/use-draft'
import { draftSeatKeys } from '@/hooks/use-draft-seats'
import { mockDraftKeys, type MockDraftLists, type MockDraftSummary } from '@/hooks/use-mock-drafts'
import type { PlayerIdentity } from '@/hooks/use-players-by-ids'
import type { Draft } from '@/types/database'

import { MobileMockReport, MobileMockReportMissing } from './mobile-mock-report'
import { MobileMocks } from './mobile-mocks'
import {
  MOCK_REPORT_COPY,
  MOCKS_COPY,
  mockFinishedLabel,
  mockReportStats,
  mockSections,
  seatsMissingLine,
} from './mocks-ops'

const unescape = (html: string) => html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&')

function client() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, retryOnMount: false } } })
}

function html(node: ReactElement, seed?: (qc: QueryClient) => void): string {
  const qc = client()
  seed?.(qc)
  return unescape(renderToStaticMarkup(createElement(QueryClientProvider, { client: qc }, node)))
}

/** Desktop colour tokens: fixed light colours that don't follow phone dark
 *  mode (the phone draws in `m-*`). The shared headshot's initials fallback
 *  (`MHeadshot`, on its own `m-head-bg` disc) is not this screen's. */
const DESKTOP_COLOUR = /^(?:[a-z]+:)*(?:text|bg|border)-(?:ink|n-\d|negative|positive|caution|surface)/
function expectPhoneTokensOnly(out: string) {
  const tokens = [...out.matchAll(/class="([^"]*)"/g)]
    .map((m) => m[1])
    .filter((cls) => !cls.includes('bg-m-head-bg'))
    .flatMap((cls) => cls.split(/\s+/))
    .filter(Boolean)
  expect(tokens.filter((t) => DESKTOP_COLOUR.test(t))).toEqual([])
}

function row(id: string, over: Partial<MockDraftSummary> = {}): MockDraftSummary {
  return {
    id,
    league_id: null,
    status: 'live',
    draft_type: 'snake',
    created_at: null,
    started_at: null,
    completed_at: null,
    current_pick_number: 37,
    current_round: 4,
    total_rounds: 15,
    // 11 bot seats + yours = a 12-team board.
    config: { mock: { cpu_seats: Array.from({ length: 11 }, (_, i) => `cpu-${i}`) } },
    ...over,
  }
}

// ---------------------------------------------------------------------------
// The pure helpers
// ---------------------------------------------------------------------------

function pick(n: number, teamId: string, playerId: string, over: Partial<DraftPickSummary> = {}): DraftPickSummary {
  return { id: `p${n}`, pick_number: n, round: Math.floor((n - 1) / 3) + 1, team_id: teamId, player_id: playerId, is_auto: false, is_undone: false, price: null, made_via: 'manager', created_at: null, ...over }
}

describe('mocks-ops', () => {
  it('sections: In progress (with the 72-hour note) then Finished (none), leaving out an empty one', () => {
    const both = mockSections({ active: [row('a')], recaps: [row('r', { status: 'complete' })] })
    expect(both.map((s) => [s.key, s.title, s.rows.length, s.note])).toEqual([
      ['active', 'In progress', 1, MOCK_PAUSED_EXPIRY_NOTE],
      ['recaps', 'Finished', 1, null],
    ])
    expect(mockSections({ active: [], recaps: [row('r', { status: 'complete' })] }).map((s) => s.key)).toEqual(['recaps'])
    expect(mockSections({ active: [], recaps: [] })).toEqual([])
  })

  it('report totals — a snake’s picks and rounds, never counting an undone pick', () => {
    const picks = [pick(1, 'a', 'p1'), pick(2, 'b', 'px', { is_undone: true }), pick(2, 'b', 'p2'), pick(3, 'c', 'p3')]
    expect(mockReportStats({ draft_type: 'snake', total_rounds: 2 }, picks, 3)).toEqual({
      count: 3,
      stats: [
        { label: 'Picks', value: '3' },
        { label: 'Rounds', value: '2' },
      ],
    })
    expect(mockReportStats({ draft_type: 'linear', total_rounds: null }, [pick(1, 'a', 'p1')], 3).stats).toEqual([
      { label: 'Pick', value: '1' },
      { label: 'Rounds', value: '0' },
    ])
  })

  it('report totals — an auction’s buys and what was spent', () => {
    const buys = [pick(1, 'a', 'p1', { price: 61 }), pick(2, 'b', 'p2', { price: 45 }), pick(3, 'c', 'p3', { price: null })]
    expect(mockReportStats({ draft_type: 'auction', total_rounds: 15 }, buys, 3)).toEqual({
      count: 3,
      stats: [
        { label: 'Buys', value: '3' },
        { label: 'Spent', value: '$106' },
      ],
    })
  })

  it('says how many seats couldn’t be read — and nothing when all were', () => {
    expect(seatsMissingLine(0, 8)).toBeNull()
    expect(seatsMissingLine(2, 8)).toBe('2 of 8 seats couldn’t be read, so some rows show no team name.')
  })

  it('a finished run’s day, or plain “Finished” with none stored', () => {
    expect(mockFinishedLabel(null)).toBe('Finished')
    expect(mockFinishedLabel('2026-10-12T18:00:00Z')).toMatch(/^Finished Oct 1[12]$/)
  })
})

// ---------------------------------------------------------------------------
// The practice home
// ---------------------------------------------------------------------------

const LISTS: MockDraftLists = {
  active: [row('a1'), row('a2', { status: 'paused', draft_type: 'auction' })],
  // r2 is a league mock (no seat count to read, and no stored finish time).
  recaps: [row('r1', { status: 'complete', completed_at: '2026-10-12T18:00:00Z' }), row('r2', { status: 'complete', league_id: 'lg1', config: {}, completed_at: null })],
}

const seeded = (lists: MockDraftLists) => (qc: QueryClient) => qc.setQueryData(mockDraftKeys.mine, lists)

function failed(data: MockDraftLists | undefined) {
  return (qc: QueryClient) => {
    const query = qc.getQueryCache().build(qc, { queryKey: mockDraftKeys.mine })
    query.setState({ ...query.state, status: 'error', error: new Error('boom'), data, fetchStatus: 'idle' })
  }
}

const home = (seed?: (qc: QueryClient) => void) => html(createElement(MobileMocks), seed)

/** One practice row's markup. */
function practiceRow(out: string, id: string): string {
  const at = out.indexOf(`data-practice-row="${id}"`)
  expect(at, id).toBeGreaterThanOrEqual(0)
  const start = out.lastIndexOf('<div', at)
  const next = out.indexOf('data-practice-row="', at + 20)
  return out.slice(start, next === -1 ? undefined : next)
}

describe('Mock drafts — the phone’s practice home (gap list §4 item 110)', () => {
  const out = home(seeded(LISTS))

  it('has its own page bar: the blue back chevron and “Mock drafts” as the h1', () => {
    expect(out).toMatch(/<button[^>]*aria-label="Back"[^>]*class="[^"]*text-accent[^"]*"[^>]*data-page-back/)
    expect(out).toMatch(/<h1[^>]*>Mock drafts<\/h1>/)
    expect(out).toContain('data-mobile-screen')
  })

  it('opens with Home’s Mock draft card — the launcher — live while under the cap', () => {
    const card = out.slice(out.indexOf('<button'), out.length)
    expect(out).toMatch(/<button type="button" class="[^"]*rounded-\[18px\] bg-m-b1[^"]*" data-practice-card="true">/)
    expect(card).toContain('Practice against AI drafters')
    expect(out).not.toMatch(/data-practice-card[^>]*disabled|disabled=""[^>]*data-practice-card/)
    expect(out).not.toContain('practice drafts running')
  })

  it('lists In progress, then Finished, each with its count, and the 72-hour note under In progress only', () => {
    const sections = [...out.matchAll(/data-mock-section="([^"]+)"/g)].map((m) => m[1])
    expect(sections).toEqual(['active', 'recaps'])
    expect(out).toMatch(/>In progress<\/h2><span[^>]*>2<\/span>/)
    expect(out).toMatch(/>Finished<\/h2><span[^>]*>2<\/span>/)
    const note = out.indexOf(MOCK_PAUSED_EXPIRY_NOTE)
    expect(note).toBeGreaterThan(out.indexOf('data-mock-section="active"'))
    expect(note).toBeLessThan(out.indexOf('data-mock-section="recaps"'))
    expect(out.split(MOCK_PAUSED_EXPIRY_NOTE)).toHaveLength(2)
  })

  it('each row says what it was and where it stands, and opens the right place', () => {
    const live = practiceRow(out, 'a1')
    expect(live).toContain('>Live<')
    expect(live).toContain('>Snake · 12 teams<')
    expect(live).toContain('Live · pick 37 of 180')
    // A standalone mock's room is /app/mocks/[id].
    expect(live).toMatch(/<a [^>]*href="\/app\/mocks\/a1"[^>]*>Rejoin<\/a>/)
    const paused = practiceRow(out, 'a2')
    expect(paused).toContain('>Auction · 12 teams<')
    expect(paused).toMatch(/<a [^>]*href="\/app\/mocks\/a2"[^>]*>Resume<\/a>/)
    // Every finished mock's report is /app/mocks/[id]/report, league or not.
    const done = practiceRow(out, 'r1')
    expect(done).toContain('>Report<')
    expect(done).toMatch(/Finished Oct 1[12]/)
    expect(done).toMatch(/<a [^>]*href="\/app\/mocks\/r1\/report"[^>]*>View report<\/a>/)
    expect(practiceRow(out, 'r2')).toMatch(/<a [^>]*href="\/app\/mocks\/r2\/report"[^>]*>View report<\/a>/)
    for (const id of ['a1', 'a2', 'r1', 'r2']) expect(practiceRow(out, id)).toMatch(/<button[^>]*aria-label="Delete (?:report|practice draft)"[^>]*>Delete<\/button>/)
    expectPhoneTokensOnly(out)
  })

  it('a league mock’s Rejoin goes to its league’s room', () => {
    const out = home(seeded({ active: [row('a3', { league_id: 'lg1', config: {} })], recaps: [] }))
    const league = practiceRow(out, 'a3')
    expect(league).toMatch(/<a [^>]*href="\/app\/leagues\/lg1\/draft\?draft=a3"[^>]*>Rejoin<\/a>/)
    // No seat count to read: the format alone, and no made-up total.
    expect(league).toContain('>Snake<')
    expect(league).toContain('Live · pick 37<')
  })

  it('with leagues hidden, an unfinished league mock’s Rejoin is off and says why; nothing else changes', () => {
    flags.leagues = false
    try {
      const out = home(seeded({ active: [row('a1'), row('a3', { league_id: 'lg1', config: {} })], recaps: [row('r2', { status: 'complete', league_id: 'lg1', config: {} })] }))
      const blocked = practiceRow(out, 'a3')
      expect(blocked).toMatch(/<span[^>]*aria-disabled="true"[^>]*>Rejoin<\/span>/)
      expect(blocked).toMatch(new RegExp(`role="status">${MOCK_LEAGUE_HIDDEN_NOTE}<`))
      expect(blocked).not.toContain('/app/leagues/')
      expect(practiceRow(out, 'a1')).toMatch(/href="\/app\/mocks\/a1"/)
      expect(practiceRow(out, 'r2')).toMatch(/href="\/app\/mocks\/r2\/report"/)
    } finally {
      flags.leagues = true
    }
  })

  it('at three running, the card is off and an orange note says why — never a launch the server would refuse', () => {
    const out = home(seeded({ active: [row('a1'), row('a2'), row('a3')], recaps: [] }))
    expect(out).toMatch(/<button type="button" disabled="" class="[^"]*disabled:opacity-50[^"]*" data-practice-card="true">/)
    const reason = launchDisabledReason(3)!
    expect(out).toMatch(new RegExp(`<p role="status" class="rounded-message[^"]*bg-m-go text-m-to">${reason}</p>`))
    // Two running: the card is live again.
    expect(home(seeded({ active: [row('a1'), row('a2')], recaps: [] }))).not.toContain(reason)
  })

  it('with no practice drafts: desktop’s empty words and the caps line, under the live card', () => {
    const out = home(seeded({ active: [], recaps: [] }))
    expect(out).toContain('data-mocks-empty')
    expect(out).toContain(`>${MOCKS_COPY.emptyTitle}<`)
    expect(out).toContain(`>${MOCKS_COPY.emptyBody}<`)
    expect(out).toContain(`>${MOCK_CAP_NOTE}<`)
    expect(out).not.toContain('data-mock-section')
    expect(out).toContain('data-practice-card')
    expectPhoneTokensOnly(out)
  })

  it('shows loading rows before the first read', () => {
    const out = home()
    expect(out).toContain('data-mocks-loading')
    expect(out).not.toContain(MOCKS_COPY.emptyTitle)
  })

  it('a failed read is an error with Try again — never “No practice drafts yet”', () => {
    const out = home(failed(undefined))
    expect(out).toContain(`>${MOCKS_COPY.loadFailed}<`)
    expect(out).toContain('>boom<')
    expect(out).toMatch(/<button[^>]*>Try again<\/button>/)
    expect(out).not.toContain(MOCKS_COPY.emptyTitle)
  })

  it('a failed refresh keeps the rows and says it could not refresh', () => {
    const out = home(failed(LISTS))
    expect(out).toMatch(new RegExp(`role="alert"[\\s\\S]*${MOCKS_COPY.refreshFailed}[\\s\\S]*Try again`))
    expect([...out.matchAll(/data-practice-row=/g)]).toHaveLength(4)
  })
})

// ---------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------

const MOCK = 'mock-1'
const ME = 'seat-me'
const C1 = 'seat-c1'
const C2 = 'seat-c2'
const ORDER = [C1, ME, C2]

function draftRow(over: Partial<Draft> = {}): Draft {
  return {
    budget_adjustments: {},
    completed_at: '2026-10-12T18:00:00Z',
    config: { mock: { human_team_id: ME, launched_by: 'user-me', cpu_seats: [C1, C2] } },
    created_at: null,
    current_deadline: null,
    current_nomination: null,
    current_pick_number: null,
    current_round: null,
    deadline_remaining_ms: null,
    draft_order: ORDER,
    draft_type: 'snake',
    id: MOCK,
    is_mock: true,
    league_id: null,
    nomination_order: null,
    on_clock_team_id: null,
    paused_at: null,
    started_at: null,
    status: 'complete',
    total_rounds: 2,
    updated_at: null,
    ...over,
  }
}

const PICKS: DraftPickSummary[] = [
  pick(1, C1, 'pl-1'),
  pick(2, ME, 'pl-2', { is_auto: true }),
  pick(3, C2, 'pl-3'),
  pick(4, C2, 'pl-4'),
  pick(5, ME, 'pl-5'),
  pick(6, C1, 'pl-6'),
]

const PLAYERS: PlayerIdentity[] = [
  { id: 'pl-1', full_name: 'Jahmyr Gibbs', position: 'RB', team: 'DET', headshot_url: null, status: null },
  { id: 'pl-2', full_name: 'Bijan Robinson', position: 'RB', team: 'ATL', headshot_url: null, status: null },
  { id: 'pl-3', full_name: 'Josh Allen', position: 'QB', team: 'BUF', headshot_url: null, status: null },
  { id: 'pl-4', full_name: 'Brock Bowers', position: 'TE', team: 'LV', headshot_url: null, status: null },
  { id: 'pl-5', full_name: 'Bears D/ST', position: 'DEF', team: 'CHI', headshot_url: null, status: null },
  { id: 'pl-6', full_name: 'Puka Nacua', position: 'WR', team: 'LAR', headshot_url: null, status: null },
]

const NAMES = new Map([
  [ME, 'My Team'],
  [C1, 'CPU 1'],
  [C2, 'CPU 2'],
])

interface ReportSeed {
  draft?: Draft | null | 'error'
  picks?: DraftPickSummary[]
  seats?: { namesById: Map<string, string>; missing: number } | 'error'
}

function report(seed: ReportSeed = {}): string {
  return html(createElement(MobileMockReport, { mockId: MOCK }), (qc) => {
    if (seed.draft === 'error') {
      const query = qc.getQueryCache().build(qc, { queryKey: draftKeys.detail(MOCK) })
      query.setState({ status: 'error', error: new Error('boom'), fetchStatus: 'idle', data: undefined, dataUpdatedAt: 0 })
      return
    }
    const draft = seed.draft === undefined ? draftRow() : seed.draft
    const picks = seed.picks ?? PICKS
    qc.setQueryData(draftKeys.detail(MOCK), { draft, picks })
    const order = draft ? ((draft.draft_order as string[] | null) ?? []) : []
    if (seed.seats === 'error') {
      const query = qc.getQueryCache().build(qc, { queryKey: draftSeatKeys.names(order) })
      query.setState({ status: 'error', error: new Error('seats down'), fetchStatus: 'idle', data: undefined, dataUpdatedAt: 0 })
    } else qc.setQueryData(draftSeatKeys.names(order), seed.seats ?? { namesById: NAMES, missing: 0 })
    const ids = [...new Set(picks.filter((p) => !p.is_undone).map((p) => p.player_id))].sort()
    qc.setQueryData(['players-by-ids', ids], PLAYERS)
  })
}

/** The pick rows, in order, as [label, name, owner]. */
function rowsOf(out: string): Array<[string, string, string]> {
  return [...out.matchAll(/data-draft-pick="\d+"[^>]*>(.*?)<\/button>/g)].map((m) => {
    const texts = [...m[1].matchAll(/>([^<>]+)</g)].map((t) => t[1].trim()).filter(Boolean)
    const name = /text-\[14px\] font-semibold text-m-t1">([^<]+)</.exec(m[1])?.[1] ?? ''
    return [texts[0], name, texts[texts.length - 1]] as [string, string, string]
  })
}

describe('Mock draft report — the phone screen (gap list §4 item 110)', () => {
  const out = report()

  it('has its own page bar: back, “Mock draft report” as the h1, and the launcher’s red Delete', () => {
    expect(out).toMatch(/<button[^>]*aria-label="Back"[^>]*data-page-back/)
    expect(out).toMatch(/<h1[^>]*>Mock draft report<\/h1>/)
    expect(out).toMatch(/<button type="button" class="[^"]*text-m-red" data-report-delete="true">Delete<\/button>/)
  })

  it('says what the run was and when it ended, over the two totals tiles', () => {
    expect(out).toContain('>Snake · 3 teams<')
    expect(out).toMatch(/>Finished Oct 1[12]</)
    const stats = [...out.matchAll(/<dt[^>]*>([^<]+)<\/dt><dd[^>]*>([^<]+)<\/dd>/g)].map((m) => [m[1], m[2]])
    expect(stats).toEqual([
      ['Picks', '6'],
      ['Rounds', '2'],
    ])
  })

  it('lists every pick of the round — player, position · team, and the seat that took him; yours in blue', () => {
    expect(rowsOf(out)).toEqual([
      ['1.01', 'Jahmyr Gibbs', 'CPU 1'],
      ['1.02', 'Bijan Robinson', 'My Team'],
      ['1.03', 'Josh Allen', 'CPU 2'],
    ])
    expect(out).toMatch(/data-mine="true"[\s\S]*?font-semibold text-accent">My Team</)
    expect(out).toContain('>By round<')
    expect(out).toContain('>By team<')
    expect(out).toContain('>Round 2<')
  })

  it('a standalone practice draft names no league; a league one says it never touched the league', () => {
    expect(out).not.toContain(MOCK_LINE)
    expect(report({ draft: draftRow({ league_id: 'lg1' }) })).toContain(MOCK_LINE)
  })

  it('draws in phone tokens only', () => {
    expectPhoneTokensOnly(out)
  })

  it('an auction: buys and what was spent, every buy in nomination order with its price', () => {
    const buys = [pick(1, C1, 'pl-1', { price: 61, round: null }), pick(2, ME, 'pl-2', { price: 45, round: null }), pick(3, C2, 'pl-3', { price: 3, round: null })]
    const auction = report({ draft: draftRow({ draft_type: 'auction' }), picks: buys })
    expect(auction).toContain('>Auction · 3 teams<')
    const stats = [...auction.matchAll(/<dt[^>]*>([^<]+)<\/dt><dd[^>]*>([^<]+)<\/dd>/g)].map((m) => [m[1], m[2]])
    expect(stats).toEqual([
      ['Buys', '3'],
      ['Spent', '$109'],
    ])
    expect(auction).toContain('>All buys<')
    expect(rowsOf(auction)).toEqual([
      ['$61', 'Jahmyr Gibbs', 'CPU 1'],
      ['$45', 'Bijan Robinson', 'My Team'],
      ['$3', 'Josh Allen', 'CPU 2'],
    ])
  })

  it('a run that ended before anyone was taken says so — not an empty round', () => {
    expect(report({ picks: [] })).toContain(`>${MOCK_REPORT_COPY.noPicks}<`)
    expect(report({ draft: draftRow({ draft_type: 'auction' }), picks: [] })).toContain(`>${MOCK_REPORT_COPY.noBuys}<`)
  })

  it('no Delete for anyone but the launcher', () => {
    const theirs = report({ draft: draftRow({ config: { mock: { human_team_id: ME, launched_by: 'someone-else' } } }) })
    expect(theirs).not.toContain('data-report-delete')
    expect(theirs).toMatch(/<h1[^>]*>Mock draft report<\/h1>/)
  })

  it('one honest empty state for a draft still running, a real draft, or none at all', () => {
    for (const draft of [draftRow({ status: 'live' }), draftRow({ is_mock: false }), null]) {
      const missing = report({ draft })
      expect(missing).toContain('data-mock-report="missing"')
      expect(missing).toContain(`>${MOCK_REPORT_COPY.missingTitle}<`)
      expect(missing).toMatch(new RegExp(`<button[^>]*>${MOCK_REPORT_COPY.backToMocks}</button>`))
      expect(missing).not.toContain('data-report-delete')
    }
    // The route's own "not here" draws the same screen.
    const routeMissing = html(createElement(MobileMockReportMissing))
    expect(routeMissing).toContain(`>${MOCK_REPORT_COPY.missingBody}<`)
    expectPhoneTokensOnly(routeMissing)
  })

  it('a failed read is an error with Try again — never the empty state', () => {
    const err = report({ draft: 'error' })
    expect(err).toContain(`>${MOCK_REPORT_COPY.loadFailed}<`)
    expect(err).toMatch(/<button[^>]*>Try again<\/button>/)
    expect(err).not.toContain(MOCK_REPORT_COPY.missingTitle)
  })

  it('team names that couldn’t be read say so with Try again — never a list of “Team” rows', () => {
    const err = report({ seats: 'error' })
    expect(err).toMatch(/role="alert" class="[^"]*rounded-message[^"]*bg-m-gr text-m-tr"[\s\S]*Couldn’t load the team names\.[\s\S]*Try again/)
    expect(rowsOf(err)).toEqual([])
  })

  it('a short seat read is said out loud over the rows', () => {
    const short = report({ seats: { namesById: new Map([[ME, 'My Team']]), missing: 2 } })
    expect(short).toContain('2 of 3 seats couldn’t be read, so some rows show no team name.')
    expect(rowsOf(short)[0]).toEqual(['1.01', 'Jahmyr Gibbs', 'Team'])
  })
})

// ---------------------------------------------------------------------------
// The routes: ByLayout, desktop unchanged
// ---------------------------------------------------------------------------

describe('the routes draw them on the phone (ByLayout), desktop unchanged', () => {
  const read = (rel: string) => readFileSync(path.join(process.cwd(), rel), 'utf8')

  it('/app/mocks: desktop keeps MocksHome, the phone gets MobileMocks', () => {
    expect(read('src/app/app/(shell)/mocks/page.tsx')).toContain('<ByLayout desktop={<MocksHome />} mobile={<MobileMocks />} />')
  })

  it('a delete, and the empty state’s “Back to practice drafts”, leave the report via useLeaveTo — never a second Mock drafts in history', () => {
    const source = read('src/components/mobile/mocks/mobile-mock-report.tsx')
    expect(source.match(/leaveTo\(PRACTICE_HOME_HREF\)/g)).toHaveLength(2)
    expect(source).not.toMatch(/router\.(?:push|replace)\(/)
  })

  it('/app/mocks/[id]/report: both answers — the report and the route’s own “not here”', () => {
    const page = read('src/app/app/(shell)/mocks/[mockId]/report/page.tsx')
    expect(page).toContain('<ByLayout desktop={<MockReportMissing />} mobile={<MobileMockReportMissing />} />')
    expect(page).toContain('<ByLayout desktop={<MockDraftReport mockId={mockId} />} mobile={<MobileMockReport mockId={mockId} />} />')
  })
})
