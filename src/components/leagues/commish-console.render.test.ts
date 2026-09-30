/**
 * commish-console.render.test.ts — M6 L.E1.33's render proofs, one per state
 * (the task: "pre-draft (the draft tools and members lead), in season,
 * playoffs, complete, empty 'nothing needs you', loading, error"), plus
 * F535's three non-obvious summary states, the doors' override-mode marker,
 * the Commissioner door in the league nav / League Home for commissioners
 * alone, and the elevation rule.
 *
 * The `league-home-season.render.test.ts` rig: `renderToStaticMarkup` over
 * the REAL `CommishConsole` with the React Query cache pre-seeded (league
 * detail, the "needs you" summary, the log's newest page); `PageHeader`
 * rendered inline (it normally portals its title / actions into the app
 * header through a store effect, which a static render never runs).
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { commishLogKeys } from '@/hooks/use-commish-log'
import { commishSummaryKeys } from '@/hooks/use-commish-summary'
import type { LeagueDetail } from '@/hooks/use-league'
import { leaguesKeys } from '@/hooks/use-leagues'
import type { CommishLogItem, CommishLogPage } from '@/lib/leagues/api/commish-log-service'
import type { CommishSummary, MatchupCorrectionItem } from '@/lib/leagues/api/commish-summary-service'
import type { TradeView } from '@/lib/leagues/api/trades-service'
import { defaultsForTeamCount } from '@/lib/leagues/settings/league-settings'
import { useOverrideMode } from '@/stores/commish-override-store'

import { COMMISH_LOG_PROBLEM_COPY } from './activity-feed-ops'
import { CommishConsole } from './commish-console'
import {
  FAAB_NOTE,
  MEMBERS_AFTER_DRAFT_NOTE,
  NEEDS_PROBLEM_COPY,
  NEEDS_STALE_COPY,
  NOTHING_NEEDS_YOU_COMPLETE_COPY,
  NOTHING_NEEDS_YOU_COPY,
  NOTHING_NEEDS_YOU_PRE_DRAFT_COPY,
  NOT_COMMISSIONER_COPY,
  OVERRIDE_OFF_COPY,
  OVERRIDE_ON_COPY,
  RECENT_MORE_LABEL,
  TOOLS_AFTER_DRAFT_NOTE,
} from './commish-console-ops'
import { LeagueHomeStates } from './league-home-states'

vi.mock('@/components/layout/app-header', () => ({
  PageHeader: ({ title, actions }: { title: ReactNode; actions?: ReactNode }) =>
    createElement('header', { 'data-page-header': '' }, createElement('h1', null, title), actions ?? null),
}))
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ user: { id: 'user-commish' }, profile: { username: 'chris' } }),
}))
vi.mock('@/hooks/use-league-channel', () => ({
  useLeagueChannel: vi.fn(() => ({ connection: 'live' })),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  usePathname: () => '/',
}))
// zustand answers its INITIAL state to a server render (getServerSnapshot),
// so the mode is observed through the hook — the settings-panel rig's shape.
vi.mock('@/stores/commish-override-store', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/stores/commish-override-store')>()
  return { ...orig, useOverrideMode: vi.fn(orig.useOverrideMode) }
})

// ---------------------------------------------------------------------------
// Rig
// ---------------------------------------------------------------------------

const LEAGUE = 'c3330000-0000-4000-8000-000000000001'
const T1 = 'c3330000-0000-4000-8000-000000000101'
const T2 = 'c3330000-0000-4000-8000-000000000102'
const T3 = 'c3330000-0000-4000-8000-000000000103'
const T4 = 'c3330000-0000-4000-8000-000000000104'
const T_RETIRED = 'c3330000-0000-4000-8000-000000000105'
const TRADE = 'c3330000-0000-4000-8000-000000000301'

const BASE = `/app/leagues/${LEAGUE}`

function detailWith(status: string, over: Partial<LeagueDetail> = {}, settingsOver: Partial<LeagueDetail['settings']> = {}): LeagueDetail {
  return {
    league: {
      id: LEAGUE,
      name: 'Console League',
      avatar_url: null,
      description: null,
      season: 2099,
      status,
      owner_id: 'user-commish',
      scoring_system_id: null,
      invite_code: null,
      invite_slug: null,
      max_teams: 8,
      created_at: null,
      updated_at: null,
      champion_team_id: null,
    },
    settings: { ...defaultsForTeamCount(8), ...settingsOver },
    members: [
      { id: 'm1', user_id: 'user-commish', team_id: T1, role: 'commissioner', is_placeholder: false, is_autodraft: false, joined_at: null, profiles: null },
      { id: 'm2', user_id: 'user-manager', team_id: T2, role: 'manager', is_placeholder: false, is_autodraft: false, joined_at: null, profiles: null },
    ],
    teams: [
      { id: T1, name: 'Alpha', owner_id: 'user-commish', status: 'active', created_at: null },
      { id: T2, name: 'Bravo', owner_id: 'user-commish', status: 'active', created_at: null },
      { id: T3, name: 'Charlie', owner_id: 'user-commish', status: 'active', created_at: null },
      { id: T4, name: 'Delta', owner_id: 'user-commish', status: 'orphaned', created_at: null },
      { id: T_RETIRED, name: 'Old Franchise', owner_id: 'user-commish', status: 'retired', created_at: null },
    ],
    my_role: 'commissioner',
    active_draft: null,
    ...over,
  } as LeagueDetail
}

const trade = (): TradeView =>
  ({
    id: TRADE,
    status: 'in_review',
    status_reason: null,
    in_flight: true,
    proposer: { team_id: T1, name: 'Alpha' },
    recipient: { team_id: T2, name: 'Bravo' },
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
  week: 5,
  round_type: 'regular',
  home: { team_id: T1, name: 'Alpha' },
  away: { team_id: T2, name: 'Bravo' },
  why: 'every_starter_finished',
  message: null,
  ...over,
})

/** The server's own "not yet" sentence (135's door), kept verbatim. */
const NOT_YET_SENTENCE = 'Not yet — Charlie’s RB is still playing (Mon 8:15 PM). A matchup can be corrected once every starter has finished.'

function summaryWith(over: Partial<CommishSummary['sections']> = {}, status = 'in_season'): CommishSummary {
  return {
    league_id: LEAGUE,
    season: 2099,
    league_status: status,
    evaluated_at: '2099-10-01T18:00:00.000Z',
    sections: {
      unmanaged_teams: { state: 'ok', teams: [{ team_id: T4, name: 'Delta', status: 'orphaned' }], no_seat_row: [{ team_id: T3, name: 'Charlie' }] },
      trades_awaiting_review: { state: 'ok', review_mode: 'commissioner', trades: [trade()] },
      matchup_corrections: {
        state: 'ok',
        weeks: [5],
        can_correct_now: [correction({ matchup_id: 'mx-now' })],
        not_yet: [correction({ matchup_id: 'mx-wait', home: { team_id: T3, name: 'Charlie' }, away: { team_id: T4, name: 'Delta' }, why: 'starters_not_finished', message: NOT_YET_SENTENCE })],
      },
      ...over,
    },
  }
}

const EMPTY_SECTIONS: CommishSummary['sections'] = {
  unmanaged_teams: { state: 'ok', teams: [], no_seat_row: [] },
  trades_awaiting_review: { state: 'ok', review_mode: 'commissioner', trades: [] },
  matchup_corrections: { state: 'ok', weeks: [], can_correct_now: [], not_yet: [] },
}

const logItem = (i: number): CommishLogItem => ({
  id: `ca-${i}`,
  action_type: 'edit_score',
  actor: { id: 'u-commish', username: 'chris' },
  target_type: 'matchup',
  target_id: 'mx-now',
  reason: null,
  before: { home_score: 98.4, away_score: 97.1, result: null, is_overridden: false },
  after: { home_score: 96.4, away_score: 97.1, result: null, is_overridden: true },
  metadata: { week: 5 },
  acting_as_team_id: null,
  reverts_action_id: null,
  created_at: `2099-10-01T1${i}:00:00.000Z`,
})

const LOG: CommishLogPage = {
  limit: 5,
  filters: { type: null, team_id: null, week: null },
  has_more: true,
  next_cursor: 'cursor-1',
  items: [0, 1, 2, 3, 4].map(logItem),
}

function failQuery(client: QueryClient, queryKey: readonly unknown[], error: Error, data?: unknown) {
  const query = client.getQueryCache().build(client, { queryKey })
  if (data !== undefined) query.setData(data)
  query.setState({ status: 'error', error, fetchStatus: 'idle' })
}

function unescapeHtml(html: string): string {
  return html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&')
}

interface Seed {
  detail?: LeagueDetail | 'error' | 'missing'
  summary?: CommishSummary | 'error' | 'degraded' | 'missing'
  log?: CommishLogPage | 'error' | 'missing'
  override?: boolean
}

function renderConsole(seed: Seed = {}): string {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, retryOnMount: false } } })
  const detail = seed.detail ?? detailWith('in_season')
  if (detail === 'error') failQuery(qc, leaguesKeys.detail(LEAGUE), new Error('league read failed'))
  else if (detail !== 'missing') qc.setQueryData(leaguesKeys.detail(LEAGUE), detail)

  const summary = seed.summary ?? summaryWith()
  if (summary === 'error') failQuery(qc, commishSummaryKeys.one(LEAGUE), new Error('commish summary: boom'))
  else if (summary === 'degraded') failQuery(qc, commishSummaryKeys.one(LEAGUE), new Error('refetch failed'), summaryWith())
  else if (summary !== 'missing') qc.setQueryData(commishSummaryKeys.one(LEAGUE), summary)

  const log = seed.log ?? LOG
  const logKey = commishLogKeys.list(LEAGUE, { limit: 5 })
  if (log === 'error') failQuery(qc, logKey, new Error('commissioner_actions: boom'))
  else if (log !== 'missing') qc.setQueryData(logKey, { pages: [log], pageParams: [undefined] })

  vi.mocked(useOverrideMode).mockReturnValue(seed.override ?? false)
  return unescapeHtml(renderToStaticMarkup(createElement(QueryClientProvider, { client: qc }, createElement(CommishConsole, { leagueId: LEAGUE }))))
}

afterEach(() => {
  vi.mocked(useOverrideMode).mockReset()
})

/** The markup of one `data-*` block, from its opening tag to the next block
 *  of the same family (good enough to scope an assertion to a section). */
function block(html: string, marker: string): string {
  const at = html.indexOf(marker)
  expect(at, `${marker} is rendered`).toBeGreaterThan(-1)
  return html.slice(at)
}

const toolGroupKeys = (html: string) => [...html.matchAll(/data-tool-group="([^"]+)"/g)].map((m) => m[1])
const hrefs = (html: string) => [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1])
/** The Tools card alone — the recent-actions card (and its "See all") follows it. */
const toolsOnly = (html: string) => {
  const tools = block(html, 'data-commish-tools-groups')
  const end = tools.indexOf('data-commish-recent')
  return end === -1 ? tools : tools.slice(0, end)
}

// ---------------------------------------------------------------------------
// In season — the full launchpad
// ---------------------------------------------------------------------------

describe('in season — needs you, the tool doors, recent actions', () => {
  it('lays out the four blocks in order: the override switch, needs you, tools, recent actions', () => {
    const html = renderConsole()
    expect(html).toContain('data-commish-console="in_season"')
    const order = ['data-commish-tools', 'data-commish-needs', 'data-commish-tools-groups', 'data-commish-recent'].map((m) => html.indexOf(m))
    expect(order.every((i) => i > -1)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
  })

  it('needs you: a team with no manager and autopilot off → ONE tap to its team page', () => {
    const html = renderConsole()
    const needs = block(html, 'data-needs-items')
    expect(needs).toContain('Delta has no manager, and autopilot is off.')
    expect(needs).toContain(`href="${BASE}/team/${T4}"`)
    expect(needs).toMatch(/data-needs-door="unmanaged"/)
  })

  it('F535(b): a team with NO seat row is said in words and offered NO door (the autopilot switch would refuse it)', () => {
    const html = renderConsole()
    const row = html.slice(html.indexOf('data-needs-item="no_seat_row"'))
    const li = row.slice(0, row.indexOf('</li>'))
    expect(li).toContain('Charlie is missing its seat in the league’s member list.')
    expect(li).not.toContain('href=')
    expect(li).not.toContain('data-needs-door')
  })

  it('needs you: a trade in the commissioner’s review → a door to the trade center, the review’s end said', () => {
    const html = renderConsole()
    expect(html).toContain('Alpha and Bravo’s trade is waiting for your review.')
    expect(html).toContain('if you do nothing it goes through on ')
    expect(html).toContain(`data-needs-door="trade_review"`)
    expect(html).toContain(`href="${BASE}/trades"`)
  })

  it('F535(c): a matchup that can be corrected gets a door; one that cannot yet shows the server’s sentence VERBATIM and no door', () => {
    const html = renderConsole()
    const section = block(html, 'data-commish-corrections')
    expect(section).toContain(`href="${BASE}/matchup/mx-now"`)
    const wait = section.slice(section.indexOf('data-correction-row="not-yet"'))
    const li = wait.slice(0, wait.indexOf('</li>'))
    expect(li).toContain('Charlie vs Delta')
    expect(li).toContain(NOT_YET_SENTENCE)
    expect(li).not.toContain('href=')
    expect(section).not.toContain(`href="${BASE}/matchup/mx-wait"`)
  })

  it('tools: six plain groups, each a door (never a copy of the control) — team pages, matchups, trade center, schedule, settings, members', () => {
    const html = renderConsole()
    expect(toolGroupKeys(html)).toEqual(['lineups', 'scores', 'trades', 'schedule', 'settings', 'members'])
    const tools = block(html, 'data-commish-tools-groups')
    // Lineups & rosters: every team that still plays — the retired franchise is history.
    for (const id of [T1, T2, T3, T4]) expect(tools).toContain(`href="${BASE}/team/${id}"`)
    expect(tools).not.toContain(`href="${BASE}/team/${T_RETIRED}"`)
    expect(tools).toContain(`href="${BASE}/matchup"`)
    expect(tools).toContain(`href="${BASE}/trades"`)
    expect(tools).toContain(`href="${BASE}/schedule"`)
    expect(tools).toContain(`href="${BASE}/settings"`)
    // In season there is no bracket to hand-pick yet — no door to it.
    expect(tools).not.toContain('standings?tab=playoffs')
    // No control is repeated here: no score field, no switch, no form.
    expect(tools).not.toMatch(/<input|<form|role="switch"/)
  })

  it('a FAAB league says where a FAAB balance is set; the members group says in words what has no screen yet', () => {
    const faab = renderConsole({ detail: detailWith('in_season', {}, { waiver_type: 'faab' }) })
    expect(faab).toContain(FAAB_NOTE)
    expect(faab).toContain(MEMBERS_AFTER_DRAFT_NOTE)
    const rolling = renderConsole({ detail: detailWith('in_season', {}, { waiver_type: 'rolling_priority' }) })
    expect(rolling).not.toContain(FAAB_NOTE)
  })

  it('EVERY door turns override mode on as it is followed (each link carries the marker)', () => {
    const html = renderConsole()
    const body = html.slice(html.indexOf('data-commish-needs'), html.indexOf('data-commish-recent'))
    const links = [...body.matchAll(/<a [^>]*>/g)].map((m) => m[0])
    expect(links.length).toBeGreaterThan(8)
    for (const a of links) expect(a, a).toContain('data-override-door="on"')
  })

  it('recent actions: the last five through League Home’s own log renderer, and a door to league activity', () => {
    const html = renderConsole()
    const recent = block(html, 'data-commish-recent')
    expect([...recent.matchAll(/data-commish-log-item="/g)]).toHaveLength(5)
    expect(recent).toContain('Recent actions')
    // L.E1.34 (F538): "See all" opens the Activity page's Commissioner tab.
    expect(recent).toContain(`href="${BASE}/activity?tab=commissioner"`)
    expect(recent).toContain(RECENT_MORE_LABEL)
  })

  it('recent actions: a failed log read is an error with retry — never "no actions yet"', () => {
    const html = renderConsole({ log: 'error' })
    expect(block(html, 'data-commish-recent')).toContain(COMMISH_LOG_PROBLEM_COPY)
  })
})

// ---------------------------------------------------------------------------
// The override switch
// ---------------------------------------------------------------------------

describe('the override-mode switch at the top — the ONE bar over the ONE store', () => {
  it('off: says what it does and offers to turn it on', () => {
    const html = renderConsole()
    expect(html).toContain(OVERRIDE_OFF_COPY)
    expect(html).toContain('data-override-toggle="off"')
    expect(html).not.toContain('✸ Override mode ON')
  })

  it('on (entered anywhere in this league): the badge, the on-copy and the exit', () => {
    const html = renderConsole({ override: true })
    expect(html).toContain('✸ Override mode ON')
    expect(html).toContain(OVERRIDE_ON_COPY)
    expect(html).toContain('data-override-toggle="on"')
  })
})

// ---------------------------------------------------------------------------
// Pre-draft, drafting, playoffs, complete
// ---------------------------------------------------------------------------

describe('pre-draft — the draft tools and members lead', () => {
  it('setup: Draft → the setup checklist + draft settings; Members → League Home’s invites; no team / score / trade doors yet', () => {
    const html = renderConsole({ detail: detailWith('setup'), summary: summaryWith({ trades_awaiting_review: { state: 'ok', review_mode: 'commissioner', trades: [] }, matchup_corrections: EMPTY_SECTIONS.matchup_corrections }, 'setup') })
    expect(html).toContain('data-commish-console="setup"')
    expect(toolGroupKeys(html)).toEqual(['draft', 'members', 'settings'])
    const tools = toolsOnly(html)
    expect(hrefs(tools)).toEqual([BASE, `${BASE}/settings`, `${BASE}#invites`, `${BASE}/settings`])
    expect(tools).toContain(TOOLS_AFTER_DRAFT_NOTE)
    expect(tools).not.toContain('/matchup')
    expect(tools).not.toContain('/trades')
    expect(tools).not.toContain('/team/')
  })

  it('setup: an open seat needs a MANAGER (the invites), never "autopilot" — and "See all" opens the whole log even before the draft (L.E1.34, F538)', () => {
    const html = renderConsole({ detail: detailWith('setup'), summary: summaryWith({ matchup_corrections: EMPTY_SECTIONS.matchup_corrections }, 'setup') })
    const needs = block(html, 'data-needs-items')
    expect(needs).toContain('Delta has no manager yet.')
    expect(needs).toContain(`href="${BASE}#invites"`)
    expect(needs).not.toContain('autopilot is off')
    expect(block(html, 'data-commish-recent')).toContain(`href="${BASE}/activity?tab=commissioner"`)
  })

  it('scheduled: the draft lobby leads', () => {
    const html = renderConsole({ detail: detailWith('scheduled'), summary: summaryWith(EMPTY_SECTIONS, 'scheduled') })
    const tools = block(html, 'data-commish-tools-groups')
    expect(hrefs(tools)[0]).toBe(`${BASE}/draft`)
    expect(html).toContain(NOTHING_NEEDS_YOU_PRE_DRAFT_COPY)
  })

  it('drafting: every draft and seat control is in the room — both groups open it', () => {
    const html = renderConsole({ detail: detailWith('drafting'), summary: summaryWith({ matchup_corrections: EMPTY_SECTIONS.matchup_corrections }, 'drafting') })
    expect(toolGroupKeys(html)).toEqual(['draft', 'members', 'settings'])
    const tools = toolsOnly(html)
    expect(hrefs(tools)).toEqual([`${BASE}/draft`, `${BASE}/draft`, `${BASE}/settings`])
    expect(block(html, 'data-needs-items')).toContain('Autopick drafts for it.')
  })
})

describe('playoffs and complete', () => {
  it('playoffs: the bracket door ACTS (override on); the schedule is a view — no "change a week’s matchups" (R1372: 130 edits only in_season)', () => {
    const html = renderConsole({ detail: detailWith('playoffs') })
    expect(html).toContain('data-commish-console="playoffs"')
    const group = block(html, 'data-tool-group="schedule"')
    const schedule = group.slice(0, group.indexOf('</section>'))
    expect(schedule).toMatch(new RegExp(`data-override-door="on"[^>]*href="${BASE}/standings\\?tab=playoffs"`))
    expect(schedule).toMatch(new RegExp(`data-override-door="view"[^>]*href="${BASE}/schedule"`))
    expect(schedule).not.toContain('Change a week')
    expect(schedule).not.toContain('remix')
    // Lineups, rosters, scores and trades are still accepted in the playoffs (165 / 170 / 135 / 156).
    expect(toolGroupKeys(html)).toEqual(['lineups', 'scores', 'trades', 'schedule', 'settings', 'members'])
  })

  it('complete (R1372): the season is over — only screens that act now, and views without action copy; nothing he’d be refused', () => {
    const html = renderConsole({
      detail: detailWith('complete'),
      summary: summaryWith({ trades_awaiting_review: EMPTY_SECTIONS.trades_awaiting_review, matchup_corrections: EMPTY_SECTIONS.matchup_corrections }, 'complete'),
    })
    expect(html).toContain('data-commish-console="complete"')
    expect(html).not.toContain('data-needs-items')
    expect(html).toContain(NOTHING_NEEDS_YOU_COMPLETE_COPY)
    expect(toolGroupKeys(html)).toEqual(['schedule', 'settings'])
    const tools = block(html, 'data-commish-tools-groups')
    expect(tools).toContain('The season is over')
    // Lineups / rosters (165 / 170), scores (135), trades (156), schedule edits (130) and
    // bracket picks (134) are all refused once the league is complete — no door, no "you can".
    for (const gone of ['/team/', '/matchup', '/trades', 'Set any team', 'Correct a matchup', 'Approve or veto', 'Change a week', 'Pick who plays']) {
      expect(tools, gone).not.toContain(gone)
    }
    // The schedule and the bracket are views: they do not switch override mode on.
    expect(tools).toMatch(new RegExp(`data-override-door="view"[^>]*href="${BASE}/schedule"`))
    expect(tools).toMatch(new RegExp(`data-override-door="view"[^>]*href="${BASE}/standings\\?tab=playoffs"`))
    expect(tools).toMatch(new RegExp(`data-override-door="on"[^>]*href="${BASE}/settings"`))
  })
})

// ---------------------------------------------------------------------------
// Empty, unavailable, loading, error
// ---------------------------------------------------------------------------

describe('empty and the not-yet-updated database (F535(a))', () => {
  it('nothing needs you: the empty copy, and no score-corrections block when no week is in play', () => {
    const html = renderConsole({ summary: summaryWith(EMPTY_SECTIONS) })
    expect(html).toContain('data-empty="commish-needs"')
    expect(html).toContain(NOTHING_NEEDS_YOU_COPY)
    expect(html).not.toContain('data-commish-corrections')
  })

  it('an UNAVAILABLE section says its own message and the empty copy is NOT said', () => {
    const message = 'Teams without a manager can’t be listed yet — the league database hasn’t been updated for autopilot. Try again after the next update.'
    const html = renderConsole({
      summary: summaryWith({ ...EMPTY_SECTIONS, unmanaged_teams: { state: 'unavailable', missing: ['team_autopilot'], message } }),
    })
    expect(html).toContain('data-needs-unavailable="unmanaged_teams"')
    expect(html).toContain(message)
    expect(html).not.toContain(NOTHING_NEEDS_YOU_COPY)
    expect(html).not.toContain('data-empty="commish-needs"')
  })

  it('an unavailable matchup read says so where the list would be — no door is invented', () => {
    const message = 'Which matchups can be corrected can’t be checked yet — the league database hasn’t been updated for it. Try again after the next update.'
    const html = renderConsole({ summary: summaryWith({ matchup_corrections: { state: 'unavailable', missing: ['commish_matchup_edit_lock'], message } }) })
    const section = block(html, 'data-commish-corrections')
    expect(section).toContain(message)
    expect(section).not.toContain('/matchup/')
  })
})

describe('loading and error', () => {
  it('loading the league: the page skeleton', () => {
    const html = renderConsole({ detail: 'missing' })
    expect(html).toContain('data-commish-console="loading"')
    expect(html).not.toContain('data-commish-needs')
  })

  it('loading what needs you: the list skeleton — never the empty copy', () => {
    const html = renderConsole({ summary: 'missing' })
    expect(html).toContain('data-skeleton="commish-needs"')
    expect(html).not.toContain(NOTHING_NEEDS_YOU_COPY)
  })

  it('the league read failed: the error with retry', () => {
    const html = renderConsole({ detail: 'error' })
    expect(html).toContain('data-commish-console="error"')
    expect(html).toContain('Couldn’t load this league.')
    expect(html).toContain('Retry')
    // R1374: the team page's ProblemCard — with its way back to the league.
    expect(html).toContain(`href="${BASE}"`)
    expect(html).toContain('Back to league')
  })

  it('the needs-you read failed: its error with retry — never "nothing needs you"; the tools still open', () => {
    const html = renderConsole({ summary: 'error' })
    const needs = block(html, 'data-commish-needs')
    expect(needs).toContain(NEEDS_PROBLEM_COPY)
    expect(needs).toContain('role="alert"')
    expect(html).not.toContain(NOTHING_NEEDS_YOU_COPY)
    expect(html).toContain('data-commish-tools-groups')
  })

  it('degraded: a failed refetch keeps the last good list under the stale banner', () => {
    const html = renderConsole({ summary: 'degraded' })
    expect(html).toContain(NEEDS_STALE_COPY)
    // R1375: the stale banner carries its own re-read.
    expect(block(html, 'data-needs-stale')).toContain('data-needs-stale-retry')
    expect(html).toContain('Delta has no manager, and autopilot is off.')
  })
})

// ---------------------------------------------------------------------------
// Commissioners only — the client half (the server gate is commish-page.test.ts)
// ---------------------------------------------------------------------------

describe('a manager never sees the console', () => {
  it('if the role changed under an open page, the console says so and mounts nothing of the commissioner’s', () => {
    const html = renderConsole({ detail: detailWith('in_season', { my_role: 'manager' }) })
    expect(html).toContain('data-commish-console="not-commissioner"')
    expect(html).toContain(NOT_COMMISSIONER_COPY)
    expect(html).not.toContain('data-commish-needs')
    expect(html).not.toContain('data-commish-tools-groups')
    expect(html).not.toContain('data-override-toggle')
  })

  it('League Home: the Commissioner door in the league nav and the header — for a commissioner, and for nobody else', () => {
    const render = (detail: LeagueDetail) => {
      const qc = new QueryClient({ defaultOptions: { queries: { retry: false, retryOnMount: false } } })
      qc.setQueryData(leaguesKeys.detail(LEAGUE), detail)
      return renderToStaticMarkup(createElement(QueryClientProvider, { client: qc }, createElement(LeagueHomeStates, { leagueId: LEAGUE })))
    }
    const commish = render(detailWith('in_season'))
    expect(commish).toContain('data-nav="commish"')
    expect(commish).toContain('data-door="commish"')
    expect(commish).toContain(`href="${BASE}/commish"`)
    const manager = render(detailWith('in_season', { my_role: 'manager' }))
    expect(manager).toContain('data-league-nav')
    expect(manager).not.toContain('data-nav="commish"')
    expect(manager).not.toContain('data-door="commish"')
    expect(manager).not.toContain(`${BASE}/commish`)
    // Pre-draft League Home has no league nav — the header door is his way in.
    const setup = render(detailWith('setup'))
    expect(setup).toContain('data-door="commish"')
    expect(render(detailWith('setup', { my_role: 'manager' }))).not.toContain(`${BASE}/commish`)
  })
})

// ---------------------------------------------------------------------------
// Elevation (CLAUDE.md) and copy
// ---------------------------------------------------------------------------

describe('design rules', () => {
  it('nothing on the console is elevated at rest — every hard shadow sits behind hover / active / focus', () => {
    for (const html of [renderConsole(), renderConsole({ detail: detailWith('setup'), summary: summaryWith(EMPTY_SECTIONS, 'setup') })]) {
      const tokens = [...html.matchAll(/class="([^"]*)"/g)].flatMap((m) => m[1].split(/\s+/))
      const resting = tokens.filter((t) => t.includes('shadow-hard') && !/^(hover|active|focus-visible|group-hover):/.test(t))
      expect(resting).toEqual([])
    }
  })

  it('plain football words: no action type, setting key, status value or ledger code reaches the text', () => {
    const html = renderConsole()
    const text = html.replace(/<[^>]+>/g, ' ')
    for (const code of ['in_season', 'in_review', 'no_seat_row', 'unmanaged_teams', 'correction_window', 'waiver_type', 'edit_score', 'commish_']) {
      expect(text, code).not.toContain(code)
    }
    expect(text).not.toMatch(/\b[QEFDR]\d{2,}\b/)
  })
})
