/**
 * activity-page.render.test.ts — L.E1.34's render proof per tab and state,
 * over REAL renders (spec §16.1 `…/activity`, §13.4, §10.3; tasks-M6 TD12;
 * PROGRESS D459; F233(d), F371, F463, F532, F534, F536).
 *
 * The house rig: `renderToStaticMarkup` over the actual page with the React
 * Query cache pre-seeded (fetches are effects; effects do not run in a static
 * render, so the cache IS the data); `useLeagueChannel` is a spy so a cell can
 * put the room in `reconnecting`; `PageHeader` renders inline.
 *
 * Tabs: All · Adds & drops · Trades · Commissioner · Stat corrections.
 * States: loading · the league failing · items (✸ linked, one line per act) ·
 * empty (each tab's words) · error-with-retry · degraded · "Show older" · a
 * failed older page · the log filtered (by team, by week — F534's words) · the
 * log opened at an entry · member names · the corrections tab mounted.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { readFileSync } from 'node:fs'
import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { commishLogKeys, type CommishLogFilters } from '@/hooks/use-commish-log'
import type { LeagueDetail } from '@/hooks/use-league'
import { leagueActivityKeys, type ActivityFilters } from '@/hooks/use-league-activity'
import { useLeagueChannel } from '@/hooks/use-league-channel'
import { leaguesKeys } from '@/hooks/use-leagues'
import { scheduleKeys, type LeagueSchedule } from '@/hooks/use-schedule'
import { statCorrectionsKeys } from '@/hooks/use-stat-corrections'
import type { ActivityFeed, ActivityItem } from '@/lib/leagues/api/activity-service'
import type { CommishLogItem, CommishLogPage } from '@/lib/leagues/api/commish-log-service'
import { defaultsForTeamCount } from '@/lib/leagues/settings/league-settings'

import { ActivityPage } from './activity-page'
import {
  ACTIVITY_TAB_LABELS,
  ADD_DROP_TYPES,
  COMMISH_ENTRY_NOTE,
  COMMISH_FILTERED_EMPTY_COPY,
  COMMISH_WEEK_NOTE,
  SHOW_OLDER_LABEL,
  TAB_EMPTY_COPY,
  TAB_INTRO_COPY,
  type ActivityRoute,
} from './activity-page-ops'

vi.mock('@/components/layout/app-header', () => ({
  PageHeader: ({ title, actions }: { title: ReactNode; actions?: ReactNode }) =>
    createElement('header', { 'data-page-header': '' }, createElement('h1', null, title), actions ?? null),
}))
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ user: { id: 'user-a' }, profile: { username: 'ann' } }),
}))
vi.mock('@/hooks/use-league-channel', () => ({
  useLeagueChannel: vi.fn(() => ({ connection: 'live' })),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  usePathname: () => '/',
}))

// ---------------------------------------------------------------------------
// Rig
// ---------------------------------------------------------------------------

const LEAGUE = 'league-1'
const T1 = 'aaaaaaaa-0000-4000-8000-000000000001'
const T2 = 'aaaaaaaa-0000-4000-8000-000000000002'
const ENTRY = 'ca340000-0000-4000-8000-000000000034'

const DETAIL: LeagueDetail = {
  league: {
    id: LEAGUE,
    name: 'Render League',
    avatar_url: null,
    description: null,
    season: 2099,
    status: 'in_season',
    owner_id: 'user-c',
    scoring_system_id: null,
    invite_code: null,
    invite_slug: null,
    max_teams: 8,
    created_at: null,
    updated_at: null,
    champion_team_id: null,
  },
  settings: defaultsForTeamCount(8),
  members: [
    { id: 'm1', user_id: 'user-c', team_id: T1, role: 'commissioner', is_placeholder: false, is_autodraft: false, joined_at: null, profiles: { username: 'chris', avatar_url: null } },
    { id: 'm2', user_id: 'user-d', team_id: T2, role: 'manager', is_placeholder: false, is_autodraft: false, joined_at: null, profiles: { username: 'dana', avatar_url: null } },
  ],
  teams: [
    { id: T1, name: 'Alpha', owner_id: 'user-c', status: 'active', created_at: null },
    { id: T2, name: 'Bravo', owner_id: 'user-d', status: 'active', created_at: null },
  ],
  my_role: 'manager',
  active_draft: null,
}

const SCHEDULE: LeagueSchedule = {
  weeks: [
    { id: 'w1', season: 2099, week: 1, status: 'final', finalized_at: '2099-09-15T12:05:00Z', median_score: null },
    { id: 'w2', season: 2099, week: 2, status: 'live', finalized_at: null, median_score: null },
  ],
  matchups: [],
}

const AT = '2099-09-10T12:00:00.123456+00:00'
const trade = (over: Partial<Extract<ActivityItem, { kind: 'transaction' }>> = {}): ActivityItem => ({
  kind: 'transaction', id: 'tx-trade', created_at: AT, type: 'trade', status: 'complete', week: 2, team_id: T1, actor_id: 'user-d', action_id: null, payload: { summary: 'Alpha gives A; Bravo gives B', via: 'commissioner_force' }, commish_action_id: 'ca-force', ...over,
})
const post = (over: Partial<Extract<ActivityItem, { kind: 'system' }>> = {}): ActivityItem => ({
  kind: 'system', id: 'p-force', created_at: AT, context: 'league', message: 'chris (commissioner) forced a trade through: Alpha gives A; Bravo gives B', actor_id: 'user-c', topic: null, week: null, commish_action_id: 'ca-force', ...over,
})
const addDrop: ActivityItem = { kind: 'transaction', id: 'tx-add', created_at: '2099-09-09T12:00:00Z', type: 'add_drop', status: 'complete', week: 2, team_id: T2, actor_id: 'user-d', action_id: 'a1', payload: { add: { name: 'Nine' } }, commish_action_id: null }

function feedPage(items: ActivityItem[], over: Partial<ActivityFeed> = {}): ActivityFeed {
  return { items, limit: 50, has_more: false, next_before: null, next_before_id: null, ...over }
}

function logItem(over: Partial<CommishLogItem> = {}): CommishLogItem {
  return {
    id: 'ca-1', action_type: 'promote_member', actor: { id: 'user-c', username: 'chris' }, target_type: 'member', target_id: null, reason: null,
    before: { role: 'manager' }, after: { role: 'co_commissioner' }, metadata: { user_id: 'user-d' }, acting_as_team_id: null, reverts_action_id: null, created_at: '2099-09-12T12:00:00Z', ...over,
  }
}
function logPage(items: CommishLogItem[], over: Partial<CommishLogPage> = {}): CommishLogPage {
  return { items, limit: 50, filters: { type: null, team_id: null, week: null }, has_more: false, next_cursor: null, ...over }
}

type Seed<T> = T[] | 'error' | { degraded: T[] } | { olderFailed: T[] } | 'missing'

function client(): QueryClient {
  // staleTime Infinity: a static render must not optimistically refetch a seeded page on mount.
  return new QueryClient({ defaultOptions: { queries: { retry: false, retryOnMount: false, staleTime: Infinity } } })
}

function seedInfinite<T>(qc: QueryClient, key: readonly unknown[], seed: Seed<T>) {
  const infinite = (pages: T[]) => ({ pages, pageParams: pages.map((_, i) => (i === 0 ? undefined : `cursor-${i}`)) })
  if (seed === 'missing') return
  const query = qc.getQueryCache().build(qc, { queryKey: key })
  if (seed === 'error') query.setState({ status: 'error', error: new Error('read failed'), fetchStatus: 'idle' })
  else if (Array.isArray(seed)) qc.setQueryData(key, infinite(seed))
  else if ('olderFailed' in seed) {
    query.setData(infinite(seed.olderFailed))
    query.setState({ status: 'error', error: new Error('page 2 failed'), fetchStatus: 'idle', fetchMeta: { fetchMore: { direction: 'forward' } } })
  } else {
    query.setData(infinite(seed.degraded))
    query.setState({ status: 'error', error: new Error('refetch failed'), fetchStatus: 'idle' })
  }
}

function render(
  route: Partial<ActivityRoute>,
  opts: {
    feed?: { filters: Omit<ActivityFilters, 'before' | 'beforeId'>; seed: Seed<ActivityFeed> }
    log?: { filters: CommishLogFilters; seed: Seed<CommishLogPage> }
    league?: 'missing' | 'error'
    connection?: 'live' | 'reconnecting'
  } = {},
): string {
  const qc = client()
  if (opts.league === 'error') {
    const query = qc.getQueryCache().build(qc, { queryKey: leaguesKeys.detail(LEAGUE) })
    query.setState({ status: 'error', error: new Error('League not found'), fetchStatus: 'idle' })
  } else if (opts.league !== 'missing') qc.setQueryData(leaguesKeys.detail(LEAGUE), DETAIL)
  qc.setQueryData(scheduleKeys.all(LEAGUE), SCHEDULE)
  if (opts.feed) seedInfinite(qc, leagueActivityKeys.pages(LEAGUE, opts.feed.filters), opts.feed.seed)
  if (opts.log) seedInfinite(qc, commishLogKeys.list(LEAGUE, opts.log.filters), opts.log.seed)
  vi.mocked(useLeagueChannel).mockReturnValue({ connection: opts.connection ?? 'live' })
  const initial: ActivityRoute = { tab: 'all', week: null, team: null, entry: null, ...route }
  return renderToStaticMarkup(createElement(QueryClientProvider, { client: qc }, createElement(ActivityPage, { leagueId: LEAGUE, initial })))
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
}

/** The active panel's markup (Radix renders the inactive panels empty). */
function panel(html: string, tab: string): string {
  const at = html.indexOf(`data-tab-panel="${tab}"`)
  expect(at, `${tab} panel`).toBeGreaterThan(-1)
  return html.slice(at)
}

const ALL = { filters: {} }

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------

describe('the page — its tabs, and the league it needs first', () => {
  it('the five tabs, in the task’s order, the active one selected', () => {
    const html = render({}, { feed: { ...ALL, seed: [feedPage([])] } })
    const labels = [...html.matchAll(/data-tab="([a-z]+)"[^>]*>([^<]+)</g)].map((m) => m[2])
    expect(labels).toStrictEqual(['All', 'Adds & drops', 'Trades', 'Commissioner', 'Stat corrections'])
    expect(html).toContain('data-activity-page="all"')
    expect(html).toContain('<h1>League activity</h1>')
    expect(html).toContain(`href="/app/leagues/${LEAGUE}"`)
  })

  it('loading: the page skeleton, no tab claimed', () => {
    const html = render({}, { league: 'missing' })
    expect(html).toContain('data-skeleton="activity-page"')
    expect(html).not.toContain('data-activity-tabs')
  })

  it('a league that will not load is the family’s problem card — never an empty feed', () => {
    const html = render({}, { league: 'error' })
    expect(html).toContain('Couldn’t load this league.')
    expect(html).not.toContain('data-activity-tabs')
  })

  it('the room dropping says so', () => {
    expect(render({}, { feed: { ...ALL, seed: [feedPage([])] }, connection: 'reconnecting' })).toContain('Reconnecting')
  })

  it('no resting elevation anywhere on the page (CLAUDE.md)', () => {
    const html = render({}, { feed: { ...ALL, seed: [feedPage([trade(), post(), addDrop], { has_more: true, next_before: AT, next_before_id: 'tx-add' })] } })
    expect(html).not.toMatch(/(?<![a-z-]:)shadow-hard/)
  })
})

describe('All — the whole feed, one line per act, ✸ linked, paged (F233(d), F371, F463)', () => {
  it('a forced trade (its row + the commissioner’s post, one receipt) is ONE ✸ line linked to its entry; a manager’s move is plain', () => {
    const html = panel(render({}, { feed: { ...ALL, seed: [feedPage([trade(), post(), addDrop])] } }), 'all')
    expect([...html.matchAll(/data-feed-item=/g)]).toHaveLength(2)
    expect(html).toContain('completed a trade (forced through by the commissioner): Alpha gives A; Bravo gives B')
    expect(html).not.toContain('chris (commissioner) forced a trade through')
    expect(html).toContain(`href="/app/leagues/${LEAGUE}/activity?tab=commissioner&entry=ca-force"`)
    expect(html).toContain('data-commissioner-entry="ca-force"')
    expect(html).toContain('added Nine')
    expect(html).toContain(TAB_INTRO_COPY.all)
  })

  it('"Show older" while the server says there is more — and not after', () => {
    const more = panel(render({}, { feed: { ...ALL, seed: [feedPage([addDrop], { has_more: true, next_before: AT, next_before_id: 'tx-add' })] } }), 'all')
    expect(more).toContain(SHOW_OLDER_LABEL)
    const done = panel(render({}, { feed: { ...ALL, seed: [feedPage([addDrop])] } }), 'all')
    expect(done).not.toContain(SHOW_OLDER_LABEL)
  })

  it('a failed older page is said beside the button — the loaded lines stay, no stale banner', () => {
    const html = panel(render({}, { feed: { ...ALL, seed: { olderFailed: [feedPage([addDrop], { has_more: true, next_before: AT, next_before_id: 'tx-add' })] } } }), 'all')
    expect(html).toContain('Couldn’t load older items.')
    expect(html).toContain(SHOW_OLDER_LABEL)
    expect(html).toContain('added Nine')
    expect(html).not.toContain('data-stale')
  })

  it('empty · error-with-retry · degraded', () => {
    expect(panel(render({}, { feed: { ...ALL, seed: [feedPage([])] } }), 'all')).toContain(TAB_EMPTY_COPY.all)
    const error = panel(render({}, { feed: { ...ALL, seed: 'error' } }), 'all')
    expect(error).toContain('Couldn’t load the activity feed.')
    expect(error).toContain('Retry')
    expect(error).not.toContain(TAB_EMPTY_COPY.all)
    const degraded = panel(render({}, { feed: { ...ALL, seed: { degraded: [feedPage([addDrop])] } } }), 'all')
    expect(degraded).toContain('added Nine')
    expect(degraded).toContain('role="status"')
  })

  it('loading: the feed skeleton', () => {
    expect(panel(render({}, { feed: { ...ALL, seed: 'missing' } }), 'all')).toContain('data-skeleton="activity"')
  })
})

describe('Adds & drops and Trades — the feed read with each tab’s filter', () => {
  it('Adds & drops reads the managers’ own move types and says where the commissioner’s are', () => {
    const html = panel(render({ tab: 'adds' }, { feed: { filters: { type: ADD_DROP_TYPES }, seed: [feedPage([addDrop])] } }), 'adds')
    expect(html).toContain('added Nine')
    expect(html).toContain(TAB_INTRO_COPY.adds)
    expect(panel(render({ tab: 'adds' }, { feed: { filters: { type: ADD_DROP_TYPES }, seed: [feedPage([])] } }), 'adds')).toContain(TAB_EMPTY_COPY.adds)
  })

  it('Trades (Q84): a trade that went through, a league-vote veto and the commissioner’s veto — one line each; empty in its own words', () => {
    const vetoByVote: ActivityItem = { kind: 'system', id: 'p-vote', created_at: '2099-09-08T12:00:00Z', context: 'league', message: 'Trade vetoed by league vote: Alpha gives C; Bravo gives D', actor_id: null, topic: null, week: null, commish_action_id: null }
    const vetoByCommish: ActivityItem = { kind: 'system', id: 'ca-veto', created_at: '2099-09-07T12:00:00Z', context: 'league', message: 'chris (commissioner) vetoed a trade: Alpha gives E; Bravo gives F', actor_id: 'user-c', topic: null, week: null, commish_action_id: 'ca-veto' }
    const html = panel(render({ tab: 'trades' }, { feed: { filters: { topic: 'trades' }, seed: [feedPage([trade(), vetoByVote, vetoByCommish])] } }), 'trades')
    expect([...html.matchAll(/data-feed-item=/g)]).toHaveLength(3)
    expect(html).toContain('Trade vetoed by league vote')
    expect(html).toContain(`href="/app/leagues/${LEAGUE}/activity?tab=commissioner&entry=ca-veto"`)
    expect(html).toContain(TAB_INTRO_COPY.trades)
    expect(panel(render({ tab: 'trades' }, { feed: { filters: { topic: 'trades' }, seed: [feedPage([])] } }), 'trades')).toContain(TAB_EMPTY_COPY.trades)
  })
})

describe('Commissioner — the whole §10.3 log, by team and week, paged, opened at an entry', () => {
  it('every action in words, members named, "Show older" on the cursor (F371)', () => {
    const html = panel(render({ tab: 'commissioner' }, { log: { filters: { limit: 50 }, seed: [logPage([logItem()], { has_more: true, next_cursor: 'tok' })] } }), 'commissioner')
    expect(html).toContain('made dana a co-commissioner')
    expect(html).toContain(SHOW_OLDER_LABEL)
    expect(html).toContain(TAB_INTRO_COPY.commissioner)
    expect(html).toContain('id="commish-log-team"')
    expect(html).toContain('id="commish-log-week"')
    expect(html).not.toContain(COMMISH_WEEK_NOTE)
  })

  it('filtered by a week: F534’s sentence says what a week shows; a filter with nothing is its own empty copy', () => {
    const html = panel(render({ tab: 'commissioner', week: 2, team: T2 }, { log: { filters: { limit: 50, team_id: T2, week: 2 }, seed: [logPage([])] } }), 'commissioner')
    expect(html).toContain(COMMISH_WEEK_NOTE)
    expect(html).toContain(COMMISH_FILTERED_EMPTY_COPY)
  })

  it('opened at an entry (a ✸ door): the entry is marked with a resting fill and the note offers the newest', () => {
    const html = panel(render({ tab: 'commissioner', entry: ENTRY }, { log: { filters: { limit: 50, entry: ENTRY }, seed: [logPage([logItem({ id: ENTRY }), logItem({ id: 'older' })])] } }), 'commissioner')
    expect(html).toContain(COMMISH_ENTRY_NOTE)
    expect(html).toContain('Back to the newest')
    expect(html).toMatch(new RegExp(`class="[^"]*bg-accent-soft[^"]*" data-commish-log-item="${ENTRY}" data-highlighted=""`))
    expect(html).not.toMatch(/data-commish-log-item="older" data-highlighted/)
  })

  it('a failed log read is an error with retry — never "no commissioner actions"', () => {
    const html = panel(render({ tab: 'commissioner' }, { log: { filters: { limit: 50 }, seed: 'error' } }), 'commissioner')
    expect(html).toContain('Couldn’t load the commissioner actions.')
    expect(html).not.toContain(COMMISH_FILTERED_EMPTY_COPY)
  })
})

describe('Stat corrections — L.E2.4’s view, mounted as the tab (F536)', () => {
  it('the view renders in the tab, opened on the linked week', () => {
    const qc = client()
    qc.setQueryData(leaguesKeys.detail(LEAGUE), DETAIL)
    qc.setQueryData(scheduleKeys.all(LEAGUE), SCHEDULE)
    qc.setQueryData(statCorrectionsKeys.list(LEAGUE, { week: 1 }), {
      pages: [{ state: 'known', page: { week: 1, items: [], limit: 50, has_more: false, next_cursor: null, note: 'No stat correction changed a score in this league in Week 1.' } }],
      pageParams: [undefined],
    })
    const html = renderToStaticMarkup(createElement(QueryClientProvider, { client: qc }, createElement(ActivityPage, { leagueId: LEAGUE, initial: { tab: 'corrections', week: 1, team: null, entry: null } })))
    const tab = panel(html, 'corrections')
    expect(tab).toContain('data-corrections-view')
    expect(tab).toContain('No stat correction changed a score in this league in Week 1.')
    expect(html).toContain(`data-tab="corrections"`)
    expect(ACTIVITY_TAB_LABELS.corrections).toBe('Stat corrections')
  })

  it('R1369 carried over: the tab writes its week back to the URL and keys the view on it (source — a static render cannot pick)', () => {
    const src = readFileSync(`${process.cwd()}/src/components/leagues/activity-page.tsx`, 'utf8')
    expect(src).toContain("key={route.week ?? 'all'}")
    expect(src).toContain("onWeekChange={(week) => go({ tab: 'corrections', week, team: null, entry: null })}")
    expect(src).toContain('router.replace(activityHref(leagueId, next), { scroll: false })')
  })
})
