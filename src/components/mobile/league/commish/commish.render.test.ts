/**
 * League Menu › Commissioner tools on the phone (gap list §4 item 109) —
 * rendered from seeded queries (`renderToStaticMarkup`; effects don't run):
 * the same reads as desktop's `CommishConsole` (`useLeague`, the "needs you"
 * summary, the log's newest page, the schedule). Sheets render inline (the
 * real one portals). The fixture league: four teams (you run Charlie), the
 * standings-schedule season — week 1 final, week 2 live, weeks 3–4 upcoming.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { COMMISH_LOG_EMPTY_COPY, COMMISH_LOG_PROBLEM_COPY } from '@/components/leagues/activity-feed-ops'
import {
  AUTOPILOT_NOTE,
  FAAB_NOTE,
  NEEDS_PROBLEM_COPY,
  NEEDS_STALE_COPY,
  NOTHING_NEEDS_YOU_COPY,
  NOT_COMMISSIONER_COPY,
  OVERRIDE_OFF_COPY,
  TOOLS_AFTER_DRAFT_NOTE,
} from '@/components/leagues/commish-console-ops'
import { REPAIR_NEEDS_OVERRIDE_COPY, REPAIR_NOTHING_COPY } from '@/components/leagues/commish-repair-ops'
import { EDIT_NO_CHANGE_COPY, NO_CHANGES_COPY, REMIX_NEEDS_OVERRIDE_COPY, SCHEDULE_EDIT_NONE_COPY } from '@/components/leagues/schedule-view-ops'
import { SCHEDULE, matchup } from '@/components/leagues/standings-schedule.fixtures'
import { useCommishEditSchedule } from '@/hooks/use-commish-schedule'
import { commishLogKeys } from '@/hooks/use-commish-log'
import { commishSummaryKeys } from '@/hooks/use-commish-summary'
import type { LeagueDetail } from '@/hooks/use-league'
import { leaguesKeys } from '@/hooks/use-leagues'
import { scheduleKeys, useConfirmRemix, useEditMatchup, useRemixPreview, type LeagueSchedule, type RemixPreview } from '@/hooks/use-schedule'
import type { CommishLogItem, CommishLogPage } from '@/lib/leagues/api/commish-log-service'
import type { CommishSummary, MatchupCorrectionItem } from '@/lib/leagues/api/commish-summary-service'
import type { TradeView } from '@/lib/leagues/api/trades-service'
import { defaultsForTeamCount } from '@/lib/leagues/settings/league-settings'
import { useOverrideMode } from '@/stores/commish-override-store'

import { OVERRIDE_ON_NOTE } from './commish-ops'
import { MobileCommishConsole } from './commish-screen'
import { EditMatchupSheet, RemixSheet, RepairSheet } from './schedule-sheets'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/app/leagues/league-1/commish',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ user: { id: 'user-me' }, profile: { username: 'dalton' }, isLoading: false }),
}))
vi.mock('@/hooks/use-league-channel', () => ({
  useLeagueChannel: vi.fn(() => ({ connection: 'live' })),
}))
// The last sheet's `onOpenChange` — what its X (and a swipe or backdrop tap) calls.
const lastSheet = vi.hoisted(() => ({ onOpenChange: ((): void => {}) as (open: boolean) => void }))
vi.mock('@/components/mobile/ui/mobile-sheet', () => ({
  // `showClose` draws the header's X (the real sheet's 32px close button).
  MobileSheet: ({ open, onOpenChange, title, subtitle, showClose, children, footer }: { open: boolean; onOpenChange: (open: boolean) => void; title: string; subtitle?: string; showClose?: boolean; children: ReactNode; footer?: ReactNode }) => {
    lastSheet.onOpenChange = onOpenChange
    return open
      ? createElement('section', { 'data-sheet': title, 'data-sub': subtitle }, showClose ? createElement('button', { type: 'button', 'aria-label': 'Close', 'data-sheet-close': '' }) : null, children, footer)
      : null
  },
}))
// zustand answers its INITIAL state to a server render, so the mode is
// observed through the hook (the desktop console rig's shape).
vi.mock('@/stores/commish-override-store', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/stores/commish-override-store')>()
  return { ...orig, useOverrideMode: vi.fn(orig.useOverrideMode) }
})
// The schedule verbs: the real hooks unless a test says what the server answered.
vi.mock('@/hooks/use-schedule', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/hooks/use-schedule')>()
  return {
    ...orig,
    useEditMatchup: vi.fn(orig.useEditMatchup),
    useRemixPreview: vi.fn(orig.useRemixPreview),
    useConfirmRemix: vi.fn(orig.useConfirmRemix),
  }
})
vi.mock('@/hooks/use-commish-schedule', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/hooks/use-commish-schedule')>()
  return { ...orig, useCommishEditSchedule: vi.fn(orig.useCommishEditSchedule) }
})

const LEAGUE = 'league-1'
const BASE = `/app/leagues/${LEAGUE}`
const NAMES = new Map([
  ['t1', 'Alpha'],
  ['t2', 'Bravo'],
  ['t3', 'Charlie'],
  ['t4', 'Delta'],
])

function detailWith(status: string, over: Partial<LeagueDetail> = {}, settingsOver: Partial<LeagueDetail['settings']> = {}): LeagueDetail {
  return {
    league: {
      id: LEAGUE,
      name: 'Sunday Funday League',
      avatar_url: null,
      description: null,
      season: 2099,
      status,
      owner_id: 'user-me',
      scoring_system_id: null,
      invite_code: null,
      invite_slug: null,
      max_teams: 4,
      created_at: null,
      updated_at: null,
      champion_team_id: null,
    },
    settings: { ...defaultsForTeamCount(8), regular_season_weeks: 3, ...settingsOver },
    members: [
      { id: 'm1', user_id: 'user-me', team_id: 't3', role: 'commissioner', is_placeholder: false, is_autodraft: false, joined_at: null, profiles: { username: 'dalton', avatar_url: null } },
      { id: 'm2', user_id: 'user-them', team_id: 't2', role: 'manager', is_placeholder: false, is_autodraft: false, joined_at: null, profiles: { username: 'marcus', avatar_url: null } },
    ],
    teams: ['t1', 't2', 't3', 't4'].map((id) => ({ id, name: NAMES.get(id)!, owner_id: 'user-me', status: 'active', created_at: null })),
    my_role: 'commissioner',
    active_draft: null,
    ...over,
  } as LeagueDetail
}

const trade = (): TradeView =>
  ({
    id: 'trade-1',
    status: 'in_review',
    status_reason: null,
    in_flight: true,
    proposer: { team_id: 't1', name: 'Alpha' },
    recipient: { team_id: 't2', name: 'Bravo' },
    note: null,
    countered_from: null,
    created_at: '2099-10-01T12:00:00.000Z',
    accepted_at: '2099-10-01T13:00:00.000Z',
    resolved_at: null,
    items: [],
    drops: [],
    review: { mode: 'commissioner', ends_at: '2099-10-02T13:00:00.000Z', ms_remaining: 3_600_000 },
    deferred: null,
    tally: null,
  }) as TradeView

const correction = (over: Partial<MatchupCorrectionItem> & Pick<MatchupCorrectionItem, 'matchup_id'>): MatchupCorrectionItem => ({
  week: 1,
  round_type: 'regular',
  home: { team_id: 't1', name: 'Alpha' },
  away: { team_id: 't2', name: 'Bravo' },
  why: 'every_starter_finished',
  message: null,
  ...over,
})

const NOT_YET = 'Not yet — Charlie’s RB is still playing (Mon 8:15 PM). A matchup can be corrected once every starter has finished.'

function summaryWith(over: Partial<CommishSummary['sections']> = {}, status = 'in_season'): CommishSummary {
  return {
    league_id: LEAGUE,
    season: 2099,
    league_status: status,
    evaluated_at: '2099-10-01T18:00:00.000Z',
    sections: {
      unmanaged_teams: { state: 'ok', teams: [{ team_id: 't4', name: 'Delta', status: 'orphaned' }], no_seat_row: [{ team_id: 't1', name: 'Alpha' }] },
      trades_awaiting_review: { state: 'ok', review_mode: 'commissioner', trades: [trade()] },
      matchup_corrections: {
        state: 'ok',
        weeks: [1],
        can_correct_now: [correction({ matchup_id: 'mx-now' })],
        not_yet: [correction({ matchup_id: 'mx-wait', home: { team_id: 't3', name: 'Charlie' }, away: { team_id: 't4', name: 'Delta' }, why: 'starters_not_finished', message: NOT_YET })],
      },
      ...over,
    },
  }
}

const EMPTY: CommishSummary['sections'] = {
  unmanaged_teams: { state: 'ok', teams: [], no_seat_row: [] },
  trades_awaiting_review: { state: 'ok', review_mode: 'commissioner', trades: [] },
  matchup_corrections: { state: 'ok', weeks: [], can_correct_now: [], not_yet: [] },
}

const logItem = (i: number): CommishLogItem => ({
  id: `ca-${i}`,
  action_type: 'edit_score',
  actor: { id: 'user-me', username: 'dalton' },
  target_type: 'matchup',
  target_id: 'm1',
  reason: i === 0 ? 'Stat fix' : null,
  before: { home_score: 98.4, away_score: 97.1, result: null, is_overridden: false },
  after: { home_score: 96.4, away_score: 97.1, result: null, is_overridden: true },
  metadata: { week: 1 },
  acting_as_team_id: null,
  reverts_action_id: null,
  created_at: `2099-10-01T1${i}:00:00.000Z`,
})

const LOG: CommishLogPage = {
  limit: 5,
  filters: { type: null, team_id: null, week: null },
  has_more: true,
  next_cursor: 'cursor-1',
  items: [0, 1, 2].map(logItem),
}

interface Seed {
  detail?: LeagueDetail | 'error' | 'missing'
  summary?: CommishSummary | 'error' | 'degraded' | 'missing'
  log?: CommishLogPage | 'error'
  schedule?: LeagueSchedule
  override?: boolean
}

function fail(qc: QueryClient, queryKey: readonly unknown[], data?: unknown) {
  const query = qc.getQueryCache().build(qc, { queryKey })
  if (data !== undefined) query.setData(data)
  query.setState({ status: 'error', error: new Error('boom'), fetchStatus: 'idle' })
}

const unescape = (html: string) => html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&')

function client(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false, retryOnMount: false } } })
}

function render(seed: Seed = {}): string {
  const qc = client()
  const detail = seed.detail ?? detailWith('in_season')
  if (detail === 'error') fail(qc, leaguesKeys.detail(LEAGUE))
  else if (detail !== 'missing') qc.setQueryData(leaguesKeys.detail(LEAGUE), detail)
  const summary = seed.summary ?? summaryWith()
  if (summary === 'error') fail(qc, commishSummaryKeys.one(LEAGUE))
  else if (summary === 'degraded') fail(qc, commishSummaryKeys.one(LEAGUE), summaryWith())
  else if (summary !== 'missing') qc.setQueryData(commishSummaryKeys.one(LEAGUE), summary)
  const logKey = commishLogKeys.list(LEAGUE, { limit: 5 })
  if (seed.log === 'error') fail(qc, logKey)
  else qc.setQueryData(logKey, { pages: [seed.log ?? LOG], pageParams: [undefined] })
  qc.setQueryData(scheduleKeys.all(LEAGUE), seed.schedule ?? SCHEDULE)
  vi.mocked(useOverrideMode).mockReturnValue(seed.override ?? false)
  return unescape(renderToStaticMarkup(createElement(QueryClientProvider, { client: qc }, createElement(MobileCommishConsole, { leagueId: LEAGUE }))))
}

function renderSheet(element: ReturnType<typeof createElement>): string {
  return unescape(renderToStaticMarkup(createElement(QueryClientProvider, { client: client() }, element)))
}

/** One tool card's markup. */
function card(html: string, key: string): string {
  const at = html.indexOf(`data-tool-group="${key}"`)
  expect(at, key).toBeGreaterThan(-1)
  const end = html.indexOf('data-tool-group=', at + 20)
  return html.slice(at, end === -1 ? html.indexOf('data-commish-recent', at) : end)
}

const hrefs = (html: string) => [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1])
/** The `<a …>` tag that opens `href`. */
const anchorTo = (html: string, href: string) => [...html.matchAll(/<a [^>]*>/g)].map((m) => m[0]).find((tag) => tag.includes(`href="${href}"`)) ?? ''

afterEach(() => {
  vi.mocked(useOverrideMode).mockReset()
  // Back to the real verbs (each test that needs a server answer sets one).
  for (const hook of [useEditMatchup, useRemixPreview, useConfirmRemix, useCommishEditSchedule]) vi.mocked(hook).mockRestore()
})

describe('the Commissioner tools screen — a phone page', () => {
  it('has the blue Back, the "Commissioner tools" title, and its blocks in the desktop order', () => {
    const html = render()
    expect(html).toMatch(/<button[^>]*aria-label="Back"[^>]*class="[^"]*text-accent[^"]*"[^>]*data-page-back/)
    expect(html).toContain('>Commissioner tools</h1>')
    expect(html).toContain('data-commish-console="in_season"')
    const order = ['data-commish-override', 'data-commish-needs', 'data-commish-corrections', 'data-commish-tools-groups', 'data-commish-recent'].map((m) => html.indexOf(m))
    expect(order.every((i) => i > -1)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
  })

  it('override off: says what it does and offers to turn it on', () => {
    const html = render()
    expect(html).toContain('data-commish-override="off"')
    expect(html).toContain(OVERRIDE_OFF_COPY)
    expect(html).toMatch(/<button[^>]*data-override-toggle="off"[^>]*>Turn on override mode</)
  })

  it('override on: the bar’s strip says so (with Turn off) and a line says what it means — no second switch', () => {
    const html = render({ override: true })
    expect(html).toContain('data-override-indicator')
    expect(html).toContain('data-commish-override="on"')
    expect(html).toContain(OVERRIDE_ON_NOTE)
    expect(html).not.toContain('data-override-toggle')
  })
})

describe('Needs you and Correcting scores — the server’s list, each with its one door', () => {
  it('a team with no manager and autopilot off: one tap to its team page, which turns override on', () => {
    const row = /<li[^>]*data-needs-item="unmanaged"[^>]*>(.*?)<\/li>/.exec(render())?.[1] ?? ''
    expect(row).toContain('Delta has no manager, and autopilot is off.')
    expect(anchorTo(row, `${BASE}/team/t4`)).toContain('data-override-door="on"')
  })

  it('a team missing its seat is said in words with NO door (the switch would refuse it)', () => {
    const row = /<li[^>]*data-needs-item="no_seat_row"[^>]*>(.*?)<\/li>/.exec(render())?.[1] ?? ''
    expect(row).toContain('Alpha is missing its seat in the league’s member list.')
    expect(row).not.toContain('href=')
  })

  it('a trade waiting for review: a door to the trade center, the review’s end said', () => {
    const row = /<li[^>]*data-needs-item="trade_review"[^>]*>(.*?)<\/li>/.exec(render())?.[1] ?? ''
    expect(row).toContain('Alpha and Bravo’s trade is waiting for your review.')
    expect(row).toContain('if you do nothing it goes through on ')
    expect(row).toContain(`href="${BASE}/trades"`)
  })

  it('a matchup that can be corrected gets a door; one that must wait shows the server’s sentence and no door', () => {
    const html = render()
    const now = /<li[^>]*data-correction-row="now"[^>]*>(.*?)<\/li>/.exec(html)?.[1] ?? ''
    expect(now).toContain('Week 1</span> · Alpha vs Bravo')
    expect(now).toContain(`href="${BASE}/matchup/mx-now"`)
    const wait = /<li[^>]*data-correction-row="not-yet"[^>]*>(.*?)<\/li>/.exec(html)?.[1] ?? ''
    expect(wait).toContain(NOT_YET)
    expect(wait).not.toContain('href=')
  })

  it('nothing needs you: the empty copy, and no Correcting scores with no week in play', () => {
    const html = render({ summary: summaryWith(EMPTY) })
    expect(html).toContain(NOTHING_NEEDS_YOU_COPY)
    expect(html).not.toContain('data-commish-corrections')
  })

  it('a section the server can’t answer says its own message, and never "nothing needs you"', () => {
    const html = render({ summary: summaryWith({ ...EMPTY, trades_awaiting_review: { state: 'unavailable', missing: 'x', message: 'Trade reviews can’t be checked yet.' } as never }) })
    expect(html).toContain('data-needs-unavailable="trades_awaiting_review"')
    expect(html).toContain('Trade reviews can’t be checked yet.')
    expect(html).not.toContain(NOTHING_NEEDS_YOU_COPY)
  })

  it('a failed read is an error with Try again — never the empty copy; the tools still open', () => {
    const html = render({ summary: 'error' })
    expect(html).toContain(NEEDS_PROBLEM_COPY)
    expect(html).toMatch(/role="alert"/)
    expect(html).not.toContain(NOTHING_NEEDS_YOU_COPY)
    expect(html).toContain('data-tool-group="lineups"')
  })

  it('a failed refresh keeps the last good list under the not-refreshing note', () => {
    const html = render({ summary: 'degraded' })
    expect(html).toContain('data-needs-stale')
    expect(html).toContain(NEEDS_STALE_COPY)
    expect(html).toContain('data-needs-item="trade_review"')
  })

  it('while it reads: the skeleton, never the empty copy', () => {
    const html = render({ summary: 'missing' })
    expect(html).toContain('data-skeleton="commish-needs"')
    expect(html).not.toContain(NOTHING_NEEDS_YOU_COPY)
  })
})

describe('Tools — a card per kind of tool, its screens as rows', () => {
  it('in season: lineups, scores, trades, schedule, settings, members — every team a row to its page', () => {
    const html = render()
    expect([...html.matchAll(/data-tool-group="([^"]+)"/g)].map((m) => m[1])).toEqual(['lineups', 'scores', 'trades', 'schedule', 'settings', 'members'])
    const lineups = card(html, 'lineups')
    expect(hrefs(lineups)).toEqual(['t1', 't2', 't3', 't4'].map((t) => `${BASE}/team/${t}`))
    // Your own team's avatar is the accent blue (the phone's team colours).
    expect(lineups).toMatch(/class="[^"]*bg-accent[^"]*"[^>]*data-team-avatar="t3"/)
    expect(hrefs(card(html, 'scores'))).toEqual([`${BASE}/matchup`])
    expect(hrefs(card(html, 'trades'))).toContain(`${BASE}/trades`)
  })

  it('every door to a screen that acts turns override on as it is followed; the members door is a view', () => {
    const html = render()
    for (const key of ['lineups', 'scores', 'trades', 'settings']) {
      const doors = [...card(html, key).matchAll(/data-override-door="([^"]+)"/g)].map((m) => m[1])
      expect(doors.length, key).toBeGreaterThan(0)
      expect(new Set(doors), key).toEqual(new Set(['on']))
    }
    expect(anchorTo(card(html, 'members'), `${BASE}/members`)).toContain('data-override-door="view"')
  })

  it('says where a FAAB balance and a no-manager team’s autopilot are set', () => {
    const html = render({ detail: detailWith('in_season', {}, { waiver_type: 'faab' }) })
    expect(card(html, 'trades')).toContain(FAAB_NOTE)
    expect(card(html, 'members')).toContain(AUTOPILOT_NOTE)
  })

  it('before the draft: the draft and members tools lead, and the rest is said to open after the draft', () => {
    const html = render({ detail: detailWith('setup'), summary: summaryWith(EMPTY, 'setup') })
    expect([...html.matchAll(/data-tool-group="([^"]+)"/g)].map((m) => m[1])).toEqual(['draft', 'members', 'settings'])
    expect(hrefs(card(html, 'draft'))).toEqual([BASE, `${BASE}/settings?section=draft`])
    expect(hrefs(card(html, 'members'))).toEqual([`${BASE}#invites`])
    expect(html).toContain(TOOLS_AFTER_DRAFT_NOTE)
    expect(html).not.toContain('data-console-schedule-edit')
  })

  it('during the draft: both groups open the draft room', () => {
    const html = render({ detail: detailWith('drafting'), summary: summaryWith(EMPTY, 'drafting') })
    expect(hrefs(card(html, 'draft'))).toEqual([`${BASE}/draft`])
    expect(hrefs(card(html, 'members'))).toEqual([`${BASE}/draft`])
  })

  it('the season over: only views — nothing he’d be refused, no schedule changes', () => {
    const html = render({ detail: detailWith('complete'), summary: summaryWith(EMPTY, 'complete') })
    expect([...card(html, 'schedule').matchAll(/data-override-door="([^"]+)"/g)].map((m) => m[1])).toEqual(['view', 'view'])
    expect(html).not.toContain('data-tool-group="lineups"')
    expect(html).not.toContain('data-console-schedule-edit')
    expect(html).not.toContain('data-console-remix')
  })
})

describe('the schedule changes — in season, in the Schedule card', () => {
  const preKickoff: LeagueSchedule = { ...SCHEDULE, weeks: SCHEDULE.weeks.map((w) => ({ ...w, status: 'upcoming', finalized_at: null })) }

  it('change an upcoming week’s matchups: the first upcoming week’s games, each with Edit, the anchor the Schedule page links to', () => {
    const schedule = card(render(), 'schedule')
    expect(schedule).toContain('id="schedule-edit"')
    expect(schedule).toContain('data-console-schedule-edit="weeks"')
    expect(schedule).toContain('data-console-edit-week="3"')
    expect(schedule).not.toContain('data-console-edit-week="2"')
    expect(schedule.split('data-edit-matchup').length - 1).toBeGreaterThan(0)
    // One week shows at a time — no chips with only one week left to change.
    expect(schedule).not.toContain('data-edit-weeks')
  })

  it('before kickoff every upcoming week is a chip, the first one on', () => {
    const fresh: LeagueSchedule = {
      ...preKickoff,
      matchups: SCHEDULE.matchups.map((m) => ({ ...m, status: 'scheduled', home_score: null, away_score: null, result: null, is_overridden: false })),
    }
    const schedule = card(render({ schedule: fresh }), 'schedule')
    const chips = /data-edit-weeks="true">(.*?)<\/div>/.exec(schedule)?.[1] ?? ''
    expect([...chips.matchAll(/aria-pressed="(true|false)"[^>]*>Week (\d+)</g)].map((m) => [m[2], m[1]])).toEqual([
      ['1', 'true'],
      ['2', 'false'],
      ['3', 'false'],
    ])
  })

  it('no week left to change: says so, no Edit (prevent, don’t refuse)', () => {
    const started: LeagueSchedule = { ...SCHEDULE, weeks: SCHEDULE.weeks.map((w) => (w.status === 'upcoming' ? { ...w, status: 'live' } : w)) }
    const schedule = card(render({ schedule: started }), 'schedule')
    expect(schedule).toContain('data-console-schedule-edit="none"')
    expect(schedule).toContain(SCHEDULE_EDIT_NONE_COPY)
    expect(schedule).not.toContain('data-edit-matchup')
  })

  it('remix: offered before kickoff; once the season has started, greyed with how to get it until override is on', () => {
    expect(card(render({ schedule: preKickoff }), 'schedule')).toMatch(/<button type="button"(?![^>]*disabled="")[^>]*data-console-remix="offered"/)
    const off = card(render(), 'schedule')
    expect(off).toMatch(/<button[^>]*disabled=""[^>]*data-console-remix="needs-override"/)
    expect(off).toContain(REMIX_NEEDS_OVERRIDE_COPY)
    const on = card(render({ override: true }), 'schedule')
    expect(on).toContain('data-console-remix="offered"')
    expect(on).not.toContain(REMIX_NEEDS_OVERRIDE_COPY)
  })

  it('re-pair: says how to get it with override off; offered with it on; said when every game is scored', () => {
    expect(card(render(), 'schedule')).toContain(REPAIR_NEEDS_OVERRIDE_COPY)
    expect(card(render({ override: true }), 'schedule')).toContain('data-console-repair="offered"')
    const scored: LeagueSchedule = { ...SCHEDULE, matchups: SCHEDULE.matchups.map((m) => ({ ...m, result: m.result ?? 'home' })) }
    const none = card(render({ schedule: scored, override: true }), 'schedule')
    expect(none).toContain('data-console-repair="none"')
    expect(none).toContain(REPAIR_NOTHING_COPY)
  })

  it('outside the regular season none of them is offered, override or not', () => {
    for (const status of ['playoffs', 'complete', 'setup', 'scheduled', 'drafting']) {
      const html = render({ detail: detailWith(status), summary: summaryWith(EMPTY, status), override: true })
      for (const marker of ['data-console-schedule-edit', 'data-console-remix', 'data-console-repair']) expect(html, `${status} ${marker}`).not.toContain(marker)
    }
  })
})

describe('Recent actions', () => {
  it('his last few on the commissioner log’s own rows — @handles, the reason — and See all to the log', () => {
    const html = render()
    const recent = html.slice(html.indexOf('data-commish-recent'))
    expect(recent.split('data-commish-line=').length - 1).toBe(3)
    expect(recent).toMatch(/<a [^>]*data-username-link="dalton"[^>]*>@dalton<\/a>/)
    expect(recent).toContain('Reason: Stat fix')
    expect(anchorTo(recent, `${BASE}/activity/commissioner`)).toContain('data-commish-recent-more')
  })

  it('a failed log read is an error with Try again; an empty log says so', () => {
    expect(render({ log: 'error' })).toContain(COMMISH_LOG_PROBLEM_COPY)
    const empty = render({ log: { ...LOG, has_more: false, next_cursor: null, items: [] } })
    expect(empty).toContain(COMMISH_LOG_EMPTY_COPY)
  })
})

describe('states', () => {
  it('loading the league: the skeleton', () => {
    expect(render({ detail: 'missing' })).toContain('data-commish-console="loading"')
  })
  it('the league read failed: Couldn’t load… with Try again', () => {
    const html = render({ detail: 'error' })
    expect(html).toContain('data-commish-console="error"')
    expect(html).toContain('Couldn’t load this league.')
    expect(html).toContain('>Try again</button>')
  })
  it('the role changed under an open page: says so and shows nothing of the commissioner’s', () => {
    const html = render({ detail: detailWith('in_season', { my_role: 'manager' }) })
    expect(html).toContain('data-commish-console="not-commissioner"')
    expect(html).toContain(NOT_COMMISSIONER_COPY)
    expect(html).not.toContain('data-commish-needs')
  })
  it('nothing rests elevated — no shadow outside an interaction state', () => {
    const html = render({ override: true })
    const tokens = [...html.matchAll(/class="([^"]*)"/g)].flatMap((m) => m[1]!.split(/\s+/))
    expect(tokens.filter((t) => /(^|:)shadow-/.test(t) && !/^(hover|active|focus|focus-visible|group-hover):/.test(t))).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// The sheets
// ---------------------------------------------------------------------------

type Mocked<T extends (...args: never[]) => unknown> = ReturnType<T>
const idle = { data: undefined, isPending: false, isError: false, error: null, reset: vi.fn() }

describe('Change matchup sheet', () => {
  const row = { id: 'm5', round_type: 'regular', status: 'scheduled', home: { id: 't1', name: 'Alpha' }, away: { id: 't4', name: 'Delta' }, home_score: null, away_score: null, result: null, is_overridden: false, editable: true }
  const teams = ['t1', 't2', 't3', 't4'].map((id) => ({ id, name: NAMES.get(id)! }))
  const sheet = () => renderSheet(createElement(EditMatchupSheet, { open: true, onOpenChange: () => {}, leagueId: LEAGUE, week: 3, row, teams }))

  it('opens on the pairing as it stands: Save stays off and says why; a reason is optional', () => {
    const html = sheet()
    expect(html).toContain('data-sheet="Change matchup"')
    expect(html).toContain('data-sub="Week 3"')
    expect(html).toMatch(/<select id="edit-home"[^>]*>.*<option value="t1"[^>]*selected=""/)
    expect(html).toContain(EDIT_NO_CHANGE_COPY)
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*data-edit-save/)
    expect(html).toContain('Reason (optional)')
  })

  it('has the header X — a way out without saving; it can’t close the sheet while the save runs', () => {
    const onOpenChange = vi.fn()
    const render = () => renderSheet(createElement(EditMatchupSheet, { open: true, onOpenChange, leagueId: LEAGUE, week: 3, row, teams }))
    expect(render()).toContain('data-sheet-close')
    lastSheet.onOpenChange(false)
    expect(onOpenChange).toHaveBeenCalledWith(false)
    onOpenChange.mockClear()
    vi.mocked(useEditMatchup).mockReturnValue({ ...idle, isPending: true } as unknown as Mocked<typeof useEditMatchup>)
    render()
    lastSheet.onOpenChange(false)
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it('a refusal shows word for word; a change shows what changed and the chat post', () => {
    vi.mocked(useEditMatchup).mockReturnValue({ ...idle, isError: true, error: new Error('Week 3 has already started.') } as unknown as Mocked<typeof useEditMatchup>)
    expect(sheet()).toContain('Week 3 has already started.')
    vi.mocked(useEditMatchup).mockReturnValue({
      ...idle,
      data: { week: 3, matchup: { matchup_id: 'm5', before: { home_team_id: 't1', away_team_id: 't4' }, after: { home_team_id: 't1', away_team_id: 't2' } }, system_post: 'Week 3 matchup changed by dalton.' },
    } as unknown as Mocked<typeof useEditMatchup>)
    const done = sheet()
    expect(done).toContain('Matchup changed.')
    expect(done).toContain('Week 3: Alpha vs Bravo.')
    expect(done).toContain('Week 3 matchup changed by dalton.')
    expect(done).toContain('data-edit-done')
    expect(done).not.toContain('data-edit-save')
  })
})

describe('Remix schedule sheet', () => {
  const plan = (over: Partial<RemixPreview> = {}): RemixPreview => ({
    league_id: LEAGUE,
    season: 2099,
    seed: 4242,
    current_seed: 1,
    first_week: 1,
    last_regular_week: 3,
    regular_season_weeks: 3,
    second_opponent: false,
    team_count: 4,
    window: { evaluated_at: '2099-09-20T00:00:00Z', first_kickoff_at: null, datum_arm: 'x', free: false, reason_required: false },
    weeks_regenerable: [3],
    weeks_frozen: [{ week: 1, week_status: 'final', reason: 'week_final' }],
    matchups_current: 6,
    matchups_regenerable: 2,
    proposed: [
      { week: 3, round_type: 'regular', home_team_id: 't1', away_team_id: 't2', regenerated: true },
      { week: 3, round_type: 'regular', home_team_id: 't3', away_team_id: 't4', regenerated: true },
    ],
    diff: [],
    change_count: 4,
    no_changes: false,
    ...over,
  })
  const sheet = () =>
    renderSheet(
      createElement(RemixSheet, { open: true, onOpenChange: () => {}, leagueId: LEAGUE, current: [...SCHEDULE.matchups, matchup({ id: 'm6', week: 3, home_team_id: 't2', away_team_id: 't3' })], names: NAMES, leagueTimeZone: null, actorName: 'dalton' }),
    )
  const preview = (data: RemixPreview | undefined, extra: object = {}) =>
    vi.mocked(useRemixPreview).mockReturnValue({ ...idle, data, preview: vi.fn(), ...extra } as unknown as Mocked<typeof useRemixPreview>)
  const confirmed = (extra: object = {}) => vi.mocked(useConfirmRemix).mockReturnValue({ ...idle, confirm: vi.fn(), ...extra } as unknown as Mocked<typeof useConfirmRemix>)

  beforeEach(() => {
    confirmed()
  })

  it('after kickoff: the override note, the redrawn weeks marked New, kept weeks said, an optional reason and the chat post preview', () => {
    preview(plan())
    const html = sheet()
    expect(html).toContain('data-window="override"')
    expect(html).toContain('data-remix-seed="4242"')
    expect(html).toContain('1 of 3 weeks redrawn · 4 changes')
    expect(html).toContain('Week 1 is final — kept as is.')
    const week = /<section aria-label="Week 3"[^>]*>(.*?)<\/section>/.exec(html)?.[1] ?? ''
    expect([...week.matchAll(/data-pairing="([^"]+)"/g)].map((m) => m[1])).toEqual(['changed', 'changed'])
    expect(week).toContain('>New</span>')
    expect(html).toContain('id="remix-reason"')
    expect(html).toContain('Schedule remixed by dalton: 1 of 3 regular-season weeks regenerated (weeks 3), 4 team-week pairings changed — after Week 1 kickoff (commissioner override)')
    expect(html).toMatch(/<button type="button"(?![^>]*disabled="")[^>]*data-confirm-remix/)
  })

  it('before kickoff there is no reason field; a draw that changes nothing keeps Confirm off and says why', () => {
    preview(plan({ window: { ...plan().window, free: true }, no_changes: true }))
    const html = sheet()
    expect(html).toContain('data-window="free"')
    expect(html).not.toContain('id="remix-reason"')
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*data-confirm-remix/)
    expect(html).toContain(NO_CHANGES_COPY)
  })

  it('has the header X — a way out without confirming (its footer is only Roll again and Confirm)', () => {
    preview(plan())
    expect(sheet()).toContain('data-sheet-close')
  })

  it('a failed preview offers Try again; a refused confirm shows the refusal word for word; a confirm shows the server’s result', () => {
    preview(undefined, { isError: true, error: new Error('league is not in season') })
    expect(sheet()).toContain('Couldn’t preview a remix. league is not in season')
    preview(plan())
    confirmed({ isError: true, error: new Error('Week 3 has kicked off.') })
    expect(sheet()).toContain('Week 3 has kicked off.')
    confirmed({ data: { weeks_regenerated: [3], matchups_replaced: 2, system_post: 'Schedule remixed by dalton.' } })
    const done = sheet()
    expect(done).toContain('Remix applied.')
    expect(done).toContain('Week 3 redrawn — 2 matchups replaced.')
    expect(done).toContain('Schedule remixed by dalton.')
    expect(done).toContain('data-remix-done')
  })
})

describe('Re-pair a matchup sheet', () => {
  it('starts at the week picker; Save is off until a pairing would change', () => {
    const html = renderSheet(
      createElement(RepairSheet, { open: true, onOpenChange: () => {}, leagueId: LEAGUE, matchups: SCHEDULE.matchups, teams: ['t1', 't2', 't3', 't4'].map((id) => ({ id, name: NAMES.get(id)! })) }),
    )
    expect(html).toContain('data-sheet="Re-pair a matchup"')
    expect(html).toMatch(/<select id="repair-week"[^>]*>.*Pick a week.*Week 3/)
    expect(html).toMatch(/<select id="repair-matchup"[^>]*disabled=""/)
    expect(html).not.toContain('id="repair-home"')
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*data-repair-save/)
    expect(html).toContain('data-sheet-close')
  })

  it('a re-pair that went through says the new pairing; one that changed nothing says why, on a neutral note', () => {
    const answered = (data: object) =>
      vi.mocked(useCommishEditSchedule).mockReturnValue({ ...idle, data, submit: vi.fn() } as unknown as Mocked<typeof useCommishEditSchedule>)
    const sheet = () => renderSheet(createElement(RepairSheet, { open: true, onOpenChange: () => {}, leagueId: LEAGUE, matchups: SCHEDULE.matchups, teams: [...NAMES].map(([id, name]) => ({ id, name })) }))
    answered({ week: 3, matchup: { matchup_id: 'm5', before: { home_team_id: 't1', away_team_id: 't4' }, after: { home_team_id: 't2', away_team_id: 't4' } }, no_changes: false, no_changes_why: null })
    const done = sheet()
    expect(done).toContain('Matchup re-paired.')
    expect(done).toContain('Week 3: Bravo vs Delta.')
    expect(done).toMatch(/class="[^"]*bg-m-gg[^"]*"[^>]*data-repair-applied/)
    answered({ week: 3, matchup: { matchup_id: 'm5', before: { home_team_id: 't1', away_team_id: 't4' }, after: { home_team_id: 't1', away_team_id: 't4' } }, no_changes: true, no_changes_why: 'That is already the pairing.' })
    const same = sheet()
    expect(same).toContain('Nothing changed.')
    expect(same).toMatch(/class="[^"]*bg-m-b1[^"]*"[^>]*data-repair-applied/)
  })
})
