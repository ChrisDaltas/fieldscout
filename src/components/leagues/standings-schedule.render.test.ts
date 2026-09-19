/**
 * standings-schedule.render.test.ts — L.D5.3's states checklist + elevation
 * pins for the three surfaces (spec §16.5.4 "required states per data
 * surface: skeleton-loading, empty (designed copy, not blank),
 * error-with-retry, degraded (banner + last-good data)"; §16.5.2's Schedule
 * & Remix row — "free-before-Week-1 vs audited-override copy"; CLAUDE.md's
 * elevation rule; PROGRESS D317).
 *
 * REAL renders — the `team-page.render.test.ts` rig: `renderToStaticMarkup`
 * over the actual components with the React Query cache pre-seeded (fetches
 * are effects and effects do not run in a static render, so the cache IS the
 * data). `useAuth` is mocked at the module edge; the three MUTATION hooks
 * (`useRemixPreview` / `useConfirmRemix` / `useEditMatchup`) are REAL hooks
 * wrapped in spies so a cell can hand a surface the exact shape a mutation
 * reports — a refusal verbatim (the R825 pattern), a plan, a result.
 *
 * The Remix modal's panel is rendered directly (`ScheduleRemixPanel`):
 * Radix's Portal renders nothing in a static render, and the states are the
 * panel's, not the portal's.
 *
 * Probes of the PR: (1) render PA before H2H → the chain-order pin here and
 * in `standings-table-ops.test.ts`; (2) remove an error branch → the
 * error-with-retry cells; (3) a resting `shadow-hard-*` on a row → the
 * elevation pin; (4) drop the E41 reason gate → the override cells.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { Dialog } from '@/components/ui/dialog'

import type { LeagueDetail } from '@/hooks/use-league'
import { leaguesKeys } from '@/hooks/use-leagues'
import {
  scheduleKeys,
  useConfirmRemix,
  useEditMatchup,
  useRemixPreview,
  type EditMatchupResult,
  type LeagueSchedule,
  type RemixConfirmResult,
  type RemixPreview,
} from '@/hooks/use-schedule'
import { leagueStandingsKeys } from '@/hooks/use-standings'
import type { LeagueStandings } from '@/lib/leagues/api/standings-service'
import { defaultsForTeamCount } from '@/lib/leagues/settings/league-settings'

import { ScheduleRemixPanel } from './schedule-remix-modal'
import { EditMatchupForm, ScheduleView } from './schedule-view'
import {
  FREE_WINDOW_TITLE,
  NO_CHANGES_COPY,
  NO_SCHEDULE_COPY,
  OVERRIDE_WINDOW_TITLE,
  PLAYOFF_PENDING_COPY,
  REASON_HINT_COPY,
} from './schedule-view-ops'
import { GOLDEN_STANDINGS, NAMES, SCHEDULE } from './standings-schedule.fixtures'
import { StandingsPage } from './standings-page'
import { NO_FINAL_WEEKS_COPY, STANDINGS_OVERRIDES_UNKNOWN_COPY } from './standings-table-ops'
import { STALE_LEAGUE_COPY } from './status-banners'

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ user: { id: 'user-commish' }, profile: { username: 'chris' } }),
}))
vi.mock('@/hooks/use-schedule', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/hooks/use-schedule')>()
  return {
    ...orig,
    useRemixPreview: vi.fn(orig.useRemixPreview),
    useConfirmRemix: vi.fn(orig.useConfirmRemix),
    useEditMatchup: vi.fn(orig.useEditMatchup),
  }
})

// ---------------------------------------------------------------------------
// Rig
// ---------------------------------------------------------------------------

const LEAGUE = 'league-1'
const settings = { ...defaultsForTeamCount(8), regular_season_weeks: 3 }

const detail: LeagueDetail = {
  league: {
    id: LEAGUE,
    name: 'Render League',
    avatar_url: null,
    description: null,
    season: 2099,
    status: 'in_season',
    owner_id: 'user-commish',
    scoring_system_id: null,
    invite_code: null,
    invite_slug: null,
    max_teams: 8,
    created_at: null,
    updated_at: null,
    champion_team_id: null,
  },
  settings,
  members: [
    { id: 'm1', user_id: 'user-commish', team_id: 't1', role: 'commissioner', is_placeholder: false, is_autodraft: false, joined_at: null, profiles: null },
    { id: 'm2', user_id: 'user-manager', team_id: 't2', role: 'manager', is_placeholder: false, is_autodraft: false, joined_at: null, profiles: null },
  ],
  teams: [...NAMES.entries()].map(([id, name]) => ({ id, name, owner_id: 'user-commish', status: 'active', created_at: null })),
  my_role: 'commissioner',
  active_draft: null,
}
const managerDetail: LeagueDetail = { ...detail, my_role: 'manager' }

function failQuery(client: QueryClient, queryKey: readonly unknown[], error: Error, data?: unknown) {
  const query = client.getQueryCache().build(client, { queryKey })
  if (data !== undefined) query.setData(data)
  query.setState({ status: 'error', error, fetchStatus: 'idle' })
}

function client(): QueryClient {
  // `retryOnMount: false` — the D316(7) reason: v5 reports an errored,
  // data-less query that would retry on mount as `pending`.
  return new QueryClient({ defaultOptions: { queries: { retry: false, retryOnMount: false } } })
}

function unescapeHtml(html: string): string {
  return html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&')
}

function render(qc: QueryClient, element: React.ReactElement): string {
  return unescapeHtml(renderToStaticMarkup(createElement(QueryClientProvider, { client: qc }, element)))
}

interface StandingsSeed {
  detail?: LeagueDetail | 'error' | 'missing' | 'gone'
  standings?: LeagueStandings | 'error' | 'degraded' | 'missing'
  /** M6A L.E1.12 — the ✸ marker's source. Default `missing` (the read is
   *  still pending), which is what every pre-existing cell renders under. */
  schedule?: LeagueSchedule | 'error' | 'missing'
}

function renderStandings(seed: StandingsSeed = {}): string {
  const qc = client()
  const d = seed.detail ?? detail
  if (d === 'error') failQuery(qc, leaguesKeys.detail(LEAGUE), new Error('Failed to load league'))
  else if (d === 'gone') failQuery(qc, leaguesKeys.detail(LEAGUE), new Error('League not found'))
  else if (d !== 'missing') qc.setQueryData(leaguesKeys.detail(LEAGUE), d)
  const s = seed.standings ?? GOLDEN_STANDINGS
  if (s === 'error') failQuery(qc, leagueStandingsKeys.all(LEAGUE), new Error('Only members of this league can view it.'))
  else if (s === 'degraded') failQuery(qc, leagueStandingsKeys.all(LEAGUE), new Error('standings: refetch boom'), GOLDEN_STANDINGS)
  else if (s !== 'missing') qc.setQueryData(leagueStandingsKeys.all(LEAGUE), s)
  const sched = seed.schedule ?? 'missing'
  if (sched === 'error') failQuery(qc, scheduleKeys.all(LEAGUE), new Error('matchups: boom'))
  else if (sched !== 'missing') qc.setQueryData(scheduleKeys.all(LEAGUE), sched)
  return render(qc, createElement(StandingsPage, { leagueId: LEAGUE }))
}

interface ScheduleSeed {
  detail?: LeagueDetail | 'error' | 'missing' | 'gone'
  schedule?: LeagueSchedule | 'error' | 'degraded' | 'missing'
}

function renderSchedule(seed: ScheduleSeed = {}): string {
  const qc = client()
  const d = seed.detail ?? detail
  if (d === 'error') failQuery(qc, leaguesKeys.detail(LEAGUE), new Error('Failed to load league'))
  else if (d === 'gone') failQuery(qc, leaguesKeys.detail(LEAGUE), new Error('This league no longer exists.'))
  else if (d !== 'missing') qc.setQueryData(leaguesKeys.detail(LEAGUE), d)
  const s = seed.schedule ?? SCHEDULE
  if (s === 'error') failQuery(qc, scheduleKeys.all(LEAGUE), new Error('league_weeks: boom'))
  else if (s === 'degraded') failQuery(qc, scheduleKeys.all(LEAGUE), new Error('league_weeks: refetch boom'), SCHEDULE)
  else if (s !== 'missing') qc.setQueryData(scheduleKeys.all(LEAGUE), s)
  return render(qc, createElement(ScheduleView, { leagueId: LEAGUE }))
}

/** The opening tag that carries `marker` — attribute ORDER is React's, so a
 *  `disabled` written before a data attribute lands before it in the markup. */
function openTagOf(html: string, marker: string): string {
  const at = html.indexOf(marker)
  expect(at, marker).toBeGreaterThan(-1)
  return html.slice(html.lastIndexOf('<', at), html.indexOf('>', at))
}

/** The slice of the markup between two markers, for per-row assertions. */
function between(html: string, from: string, to: string): string {
  const start = html.indexOf(from)
  const end = html.indexOf(to, start + 1)
  return html.slice(start, end === -1 ? undefined : end)
}

// ---------------------------------------------------------------------------
// Standings — the four states + the DoD chain-order pin
// ---------------------------------------------------------------------------

describe('standings — the four required states (§16.5.4)', () => {
  it('skeleton while the league loads; skeleton for the table while the standings load', () => {
    const league = renderStandings({ detail: 'missing' })
    expect(league).toContain('bg-n-4')
    expect(league).not.toContain('Alpha')
    const table = renderStandings({ standings: 'missing' })
    expect(table).toContain('data-skeleton="standings-table"')
    expect(table).toContain('data-view="final"') // the page chrome is up; only the table waits
  })

  it('error-with-retry when the league or the standings read fails; ONE 404 copy (F250(a))', () => {
    const league = renderStandings({ detail: 'error' })
    expect(league).toContain('Couldn’t load this league.')
    expect(league).toContain('Retry')
    expect(league).toContain('role="alert"')
    expect(renderStandings({ detail: 'gone' })).toContain('This league no longer exists.')
    const table = renderStandings({ standings: 'error' })
    expect(table).toContain('Couldn’t load the standings.')
    expect(table).toContain('Only members of this league can view it.')
    expect(table).toContain('Retry')
    expect(table).not.toContain('data-standings-table')
  })

  it('degraded: a failed refetch keeps the last-good table behind the banner', () => {
    const html = renderStandings({ standings: 'degraded' })
    expect(html).toContain(STALE_LEAGUE_COPY)
    expect(html).toContain('data-standings-table')
    expect(html).toContain('Charlie')
    expect(html).not.toContain('Couldn’t load the standings.')
  })

  it('empty is BY REASON: no_final_weeks renders the designed copy over the ranked rows', () => {
    const html = renderStandings({ standings: { ...GOLDEN_STANDINGS, weeks_final: 0, reason: 'no_final_weeks' } })
    expect(html).toContain(NO_FINAL_WEEKS_COPY)
    expect(html).toContain('data-standings-table')
    expect(html).toContain('>0</span> weeks final')
  })
})

describe('standings — the table is the RPC’s order, the chain the stored order (THE DoD PIN)', () => {
  it('the chain strip renders win_pct → points_for → head_to_head → points_against → division_record → coin_flip, and H2H precedes PA', () => {
    const html = renderStandings()
    const entries = [...html.matchAll(/data-chain-entry="([a-z_]+)"/g)].map((m) => m[1])
    expect(entries).toEqual(['win_pct', 'points_for', 'head_to_head', 'points_against', 'division_record', 'coin_flip'])
    const strip = between(html, 'data-chain', 'data-standings-table>')
    expect(strip.indexOf('>H2H<')).toBeLessThan(strip.indexOf('>PA<'))
    // The inert Q30 entry is struck, with 117's reason on hover.
    expect(between(html, 'data-chain-entry="division_record"', 'data-chain-entry="coin_flip"')).toContain('line-through')
    expect(html).toContain('title="inert — divisions are off in v1"')
  })

  it('rows render in rank order with 117’s separator on each — Charlie placed by H2H, never re-derived', () => {
    const html = renderStandings()
    const rows = [...html.matchAll(/data-team="(t\d)" data-separated-by="([a-z_]*)"/g)].map((m) => [m[1], m[2]])
    expect(rows).toEqual([
      ['t1', ''],
      ['t2', 'win_pct'],
      ['t3', 'head_to_head'],
      ['t4', 'win_pct'],
    ])
    const charlie = between(html, 'data-team="t3"', 'data-team="t4"')
    expect(charlie).toContain('Charlie')
    expect(charlie).toContain('>H2H<')
    expect(charlie).toContain('280.00')
    expect(charlie).toContain('.667')
    expect(charlie).toContain('2-1')
    // The viewer's own franchise (t1 — the commissioner) carries a resting
    // FILL, never a shadow (CLAUDE.md: state by fill, elevation by hover).
    expect(between(html, 'data-team="t1"', 'data-team="t2"')).toContain('bg-accent-soft')
    expect(html).toContain('Coin flips are seeded')
    expect(html).toContain('424242')
  })

  it('the Final | Projected control is LIVE (L.D5.5 — F253(a) discharged): both segments enabled, Final selected by default, no task id on screen', () => {
    const html = renderStandings()
    expect(openTagOf(html, 'data-view="final"')).toContain('aria-pressed="true"')
    expect(openTagOf(html, 'data-view="projected"')).toContain('aria-pressed="false"')
    expect(openTagOf(html, 'data-view="projected"')).not.toMatch(/ disabled=""/)
    expect(html).not.toContain('data-projected-copy') // the projected line shows only under the projected view
    expect(html).not.toMatch(/L\.D\d|F253|Q38|B9/)
  })

  it('the extra-record columns follow the settings', () => {
    expect(renderStandings()).not.toContain('vs median')
    const qc = client()
    qc.setQueryData(leaguesKeys.detail(LEAGUE), { ...detail, settings: { ...settings, median_game: true, second_opponent: true } })
    qc.setQueryData(leagueStandingsKeys.all(LEAGUE), GOLDEN_STANDINGS)
    const html = render(qc, createElement(StandingsPage, { leagueId: LEAGUE }))
    expect(html).toContain('vs median')
    expect(html).toContain('2nd opp')
  })
})

// ---------------------------------------------------------------------------
// The commissioner-adjusted marker — M6A L.E1.12 (`matchups.is_overridden`)
//
// PROBES (each shown RED against a one-site break, then restored):
//   P10 — `overriddenWeeksByTeam` marks every team of every row (drop the
//         `is_overridden !== true` test) → the exactly-when cell;
//   P11 — swallow the failed read (`overridesUnknown={false}`) → the
//         unknown cell.
// ---------------------------------------------------------------------------

describe('standings — the ✸ marker is present EXACTLY when `matchups.is_overridden` is', () => {
  const rowOf = (html: string, teamId: string) => between(html, `data-team="${teamId}"`, '</tr>')

  it('PREMISE: the fixture overrides exactly ONE regular-season row — m2, Week 1, t3 vs t4', () => {
    const flagged = SCHEDULE.matchups.filter((m) => m.is_overridden)
    expect(flagged.map((m) => [m.id, m.week, m.round_type, m.home_team_id, m.away_team_id])).toStrictEqual([['m2', 1, 'regular', 't3', 't4']])
  })

  it('both sides of the overridden row carry the marker (D342: one flag on the ROW), naming the week; the other teams carry none', () => {
    const html = renderStandings({ schedule: SCHEDULE })
    for (const teamId of ['t3', 't4']) {
      const row = rowOf(html, teamId)
      expect(row, teamId).toContain('data-overridden="1"')
      expect(row, teamId).toContain('✸')
      // The words are there for a screen reader, not only in a title.
      expect(row, teamId).toContain('<span class="sr-only">Commissioner-adjusted — the score or result of this team’s Week 1 matchup was set by the commissioner.</span>')
    }
    for (const teamId of ['t1', 't2']) {
      expect(rowOf(html, teamId), teamId).not.toContain('data-overridden')
      expect(rowOf(html, teamId), teamId).not.toContain('✸')
    }
    expect(html).toContain('data-overridden-legend')
  })

  it('no flag ⇒ no marker and no legend', () => {
    const clean = { ...SCHEDULE, matchups: SCHEDULE.matchups.map((m) => ({ ...m, is_overridden: false })) }
    const html = renderStandings({ schedule: clean })
    expect(html).toContain('data-team="t3"') // premise: the table rendered
    expect(html).not.toContain('data-overridden')
    expect(html).not.toContain('data-overrides-unknown')
  })

  it('a PLAYOFF row’s flag does not mark the regular-season table', () => {
    const playoffOnly = { ...SCHEDULE, matchups: SCHEDULE.matchups.map((m) => (m.id === 'm2' ? { ...m, round_type: 'playoff' } : m)) }
    expect(renderStandings({ schedule: playoffOnly })).not.toContain('data-overridden')
  })

  it('a FAILED flag read is SAID — an absent ✸ then means "unknown", never "no overrides"', () => {
    const html = renderStandings({ schedule: 'error' })
    expect(html).toContain('data-team="t3"') // the table still renders
    expect(html).toContain('data-overrides-unknown')
    expect(html).toContain(STANDINGS_OVERRIDES_UNKNOWN_COPY)
    // …and a read still in flight says nothing yet.
    expect(renderStandings()).not.toContain('data-overrides-unknown')
  })
})

// ---------------------------------------------------------------------------
// Schedule — the four states, the grid, the commissioner's affordances
// ---------------------------------------------------------------------------

describe('schedule — the four required states (§16.5.4)', () => {
  it('skeleton while the league loads; skeleton for the grid while the schedule loads', () => {
    expect(renderSchedule({ detail: 'missing' })).not.toContain('Render League')
    const grid = renderSchedule({ schedule: 'missing' })
    expect(grid).toContain('data-skeleton="schedule-grid"')
    expect(grid).toContain('data-schedule-toolbar') // the page chrome is up; only the grid waits
  })

  it('error-with-retry when the league or the schedule read fails; ONE 404 copy', () => {
    const league = renderSchedule({ detail: 'error' })
    expect(league).toContain('Couldn’t load this league.')
    expect(league).toContain('Retry')
    expect(renderSchedule({ detail: 'gone' })).toContain('This league no longer exists.')
    const grid = renderSchedule({ schedule: 'error' })
    expect(grid).toContain('Couldn’t load the schedule.')
    expect(grid).toContain('league_weeks: boom')
    expect(grid).toContain('Retry')
    expect(grid).not.toContain('data-schedule-grid')
  })

  it('degraded: a failed refetch keeps the last-good grid behind the banner', () => {
    const html = renderSchedule({ schedule: 'degraded' })
    expect(html).toContain(STALE_LEAGUE_COPY)
    expect(html).toContain('data-schedule-grid')
    expect(html).not.toContain('Couldn’t load the schedule.')
  })

  it('empty: no weeks is designed copy, never a blank grid', () => {
    const html = renderSchedule({ schedule: { weeks: [], matchups: [] } })
    expect(html).toContain(NO_SCHEDULE_COPY)
    expect(html).not.toContain('data-schedule-grid')
  })
})

describe('schedule — the grid and the commissioner’s doors', () => {
  it('one card per week with the §16.5.4 badge; the playoff week pending BY NAME; second games and the ✸ badge named; the current week marked', () => {
    const html = renderSchedule()
    expect([...html.matchAll(/data-week="(\d)" data-week-kind="(\w+)"/g)].map((m) => [m[1], m[2]])).toEqual([
      ['1', 'regular'],
      ['2', 'regular'],
      ['3', 'regular'],
      ['4', 'playoff'],
    ])
    expect(html).toContain(PLAYOFF_PENDING_COPY)
    expect(between(html, 'data-week="1"', 'data-week="2"')).toContain('>Final<')
    expect(between(html, 'data-week="1"', 'data-week="2"')).toContain('✸ commissioner-adjusted')
    expect(between(html, 'data-week="1"', 'data-week="2"')).toContain('120.50')
    expect(between(html, 'data-week="2"', 'data-week="3"')).toContain('>Live<')
    expect(between(html, 'data-week="2"', 'data-week="3"')).toContain('>Current<')
    expect(between(html, 'data-week="2"', 'data-week="3"')).toContain('pending') // E61: the unscored side
    expect(between(html, 'data-week="3"', 'data-week="4"')).toContain('second game')
    expect(between(html, 'data-week="3"', 'data-week="4"')).toContain('>—<')
    expect(html).not.toMatch(/L\.D\d|Q39|Q30/)
  })

  it('the COMMISSIONER sees Remix and an Edit on every editable row of the upcoming week — and the ladder’s reason hint', () => {
    const html = renderSchedule()
    expect(html).toContain('data-remix-open')
    expect(between(html, 'data-week="1"', 'data-week="2"')).not.toContain('data-edit-matchup')
    expect(between(html, 'data-week="2"', 'data-week="3"')).not.toContain('data-edit-matchup')
    expect(between(html, 'data-week="3"', 'data-week="4"').match(/data-edit-matchup/g)).toHaveLength(4)
    expect(html).toContain(REASON_HINT_COPY)
  })

  it('a MANAGER sees neither door and no hint — the affordances are commissioner-only', () => {
    const html = renderSchedule({ detail: managerDetail })
    expect(html).not.toContain('data-remix-open')
    expect(html).not.toContain('data-edit-matchup')
    expect(html).not.toContain(REASON_HINT_COPY)
    expect(html).toContain('data-schedule-grid')
  })
})

// ---------------------------------------------------------------------------
// The edit form — never optimistic; the refusal verbatim
// ---------------------------------------------------------------------------

const EDIT_ROW = {
  id: 'm5',
  round_type: 'regular',
  status: 'scheduled',
  home: { id: 't1', name: 'Alpha' },
  away: { id: 't4', name: 'Delta' },
  home_score: null,
  away_score: null,
  result: null,
  is_overridden: false,
  editable: true,
}
const TEAMS = [...NAMES.entries()].map(([id, name]) => ({ id, name }))

function renderEditForm(mock: Partial<ReturnType<typeof useEditMatchup>>): string {
  vi.mocked(useEditMatchup).mockReturnValueOnce({
    data: undefined,
    error: null,
    isError: false,
    isPending: false,
    edit: () => {},
    reset: () => {},
    ...mock,
  } as unknown as ReturnType<typeof useEditMatchup>)
  return render(client(), createElement(EditMatchupForm, { leagueId: LEAGUE, row: EDIT_ROW, teams: TEAMS, onClose: () => {} }))
}

describe('the matchup edit form', () => {
  it('offers the reason always, saves through the hook, and says it is OPTIONAL — never "required" (Q66 / F361)', () => {
    const html = renderEditForm({})
    expect(html).toContain('data-edit-form')
    expect(html).toContain('data-edit-reason')
    expect(html).toContain('optional — posted to league chat if you give one')
    expect(between(html, 'data-edit-form', 'data-edit-save')).not.toMatch(/required/i)
    expect(html).toContain('data-edit-save')
  })

  it('a refusal renders the RPC’s sentence VERBATIM (role="alert") — and a refusal that names the reason marks the field (probe 4’s cell)', () => {
    // The one reason refusal left since 131 — the 500 bound (22023 → 400);
    // the client strips only the `fn: ` prefix and the trailing citation.
    const refusal = 'the reason is 501 characters — at most 500'
    const html = renderEditForm({ isError: true, error: new Error(refusal) })
    expect(html).toContain(refusal)
    expect(html).toContain('role="alert"')
    expect(html).toContain('aria-invalid="true"')
    expect(html).toContain('see the refusal below')
    expect(html).not.toContain('Something went wrong')
  })

  it('success renders the server’s result and the D97 post exactly as written', () => {
    const result: EditMatchupResult = {
      league_id: LEAGUE,
      season: 2099,
      action_id: 'a',
      week: 3,
      round_type: 'regular',
      matchup: { matchup_id: 'm5', before: { home_team_id: 't1', away_team_id: 't4' }, after: { home_team_id: 't1', away_team_id: 't3' } },
      siblings: [],
      rows_changed: 2,
      reason_required: false,
      window: { evaluated_at: '2099-01-01T00:00:00Z', first_kickoff_at: null, datum_arm: 'nfl_weeks.starts_at', free: true, reason_required: false },
      system_post: 'Week 3 matchup edited by chris: Alpha vs Charlie (was Alpha vs Delta); Bravo vs Delta (was Bravo vs Charlie).',
    }
    const html = renderEditForm({ data: result })
    expect(html).toContain('data-edit-applied')
    expect(html).toContain('rows changed')
    expect(html).toContain('>2</span> rows changed')
    expect(html).toContain(result.system_post)
    expect(html).not.toContain('data-edit-form')
  })
})

// ---------------------------------------------------------------------------
// The Remix panel — loading / error / preview (BOTH E41 copies) / refusal /
// applied
// ---------------------------------------------------------------------------

const PLAN: RemixPreview = {
  league_id: LEAGUE,
  season: 2099,
  seed: 20990117,
  current_seed: 1,
  first_week: 1,
  last_regular_week: 3,
  regular_season_weeks: 3,
  second_opponent: true,
  team_count: 4,
  window: { evaluated_at: '2099-01-01T00:00:00Z', first_kickoff_at: '2099-09-13T17:00:00.000Z', datum_arm: 'nfl_games', free: true, reason_required: false },
  weeks_regenerable: [3],
  weeks_frozen: [
    { week: 1, week_status: 'final', reason: 'week_final' },
    { week: 2, week_status: 'live', reason: 'week_live' },
  ],
  matchups_current: 8,
  matchups_regenerable: 4,
  proposed: [
    { week: 3, round_type: 'regular', home_team_id: 't1', away_team_id: 't3', regenerated: true },
    { week: 3, round_type: 'regular', home_team_id: 't2', away_team_id: 't4', regenerated: true },
    { week: 3, round_type: 'secondary', home_team_id: 't2', away_team_id: 't1', regenerated: true },
    { week: 3, round_type: 'secondary', home_team_id: 't3', away_team_id: 't4', regenerated: true },
  ],
  diff: [
    { week: 3, round_type: 'regular', team_id: 't1', team_name: 'Alpha', old_opponent_id: 't4', old_opponent_name: 'Delta', new_opponent_id: 't3', new_opponent_name: 'Charlie', old_side: 'home', new_side: 'home', text: 'Week 3: Alpha now plays Charlie instead of Delta' },
  ],
  change_count: 4,
  no_changes: false,
}
const OVERRIDE_PLAN: RemixPreview = {
  ...PLAN,
  window: { ...PLAN.window, first_kickoff_at: '2001-09-09T17:00:00.000Z', free: false, reason_required: true },
}

function renderRemix(
  preview: Partial<ReturnType<typeof useRemixPreview>>,
  confirm: Partial<ReturnType<typeof useConfirmRemix>> = {},
): string {
  vi.mocked(useRemixPreview).mockReturnValueOnce({
    data: undefined,
    error: null,
    isError: false,
    isPending: false,
    preview: () => {},
    reset: () => {},
    ...preview,
  } as unknown as ReturnType<typeof useRemixPreview>)
  vi.mocked(useConfirmRemix).mockReturnValueOnce({
    data: undefined,
    error: null,
    isError: false,
    isPending: false,
    confirm: () => {},
    reset: () => {},
    ...confirm,
  } as unknown as ReturnType<typeof useConfirmRemix>)
  // `DialogTitle`/`DialogDescription` need the Dialog ROOT's context; the
  // root renders its children in place (no portal), so the panel's markup is
  // exactly what the open modal paints.
  return render(
    client(),
    createElement(
      Dialog,
      { open: true },
      createElement(ScheduleRemixPanel, {
        leagueId: LEAGUE,
        current: SCHEDULE.matchups,
        teamNames: NAMES,
        leagueTimeZone: 'America/New_York',
        actorName: 'chris',
        onClose: () => {},
      }),
    ),
  )
}

describe('the Remix panel', () => {
  it('loading: a skeleton while the seed previews; error-with-retry when the preview fails, its message verbatim', () => {
    expect(renderRemix({ isPending: true })).toContain('data-skeleton="remix-preview"')
    const html = renderRemix({ isError: true, error: new Error('Only the commissioner can remix this league’s schedule.') })
    expect(html).toContain('Couldn’t preview a remix.')
    expect(html).toContain('Only the commissioner can remix this league’s schedule.')
    expect(html).toContain('Try again')
  })

  it('FREE (E41 before kickoff, D290): the free copy, NO reason field, the side-by-side with the changed pairings, the frozen weeks by reason, the post preview, Confirm enabled', () => {
    const html = renderRemix({ data: PLAN })
    expect(html).toContain('data-window="free"')
    expect(html).toContain(FREE_WINDOW_TITLE)
    expect(html).not.toContain(OVERRIDE_WINDOW_TITLE)
    expect(html).not.toContain('data-remix-reason')
    expect(html).toContain('Week 1 is final — kept as is.')
    expect(html).toContain('Week 2 is live — kept as is.')
    // A REAL diff: week 3's regular pairings differ; the current column
    // shows the old pairing as changed, the proposed the new one.
    const week3 = between(html, 'data-week="3"', '</details>')
    expect(week3).toContain('data-regenerated="true"')
    expect(week3.match(/data-pairing="changed"/g)?.length).toBe(4)
    expect(week3).toContain('Alpha vs Delta')
    expect(week3).toContain('Alpha vs Charlie')
    expect(week3).toContain('data-pairing="flipped"')
    expect(html).toContain('Week 3: Alpha now plays Charlie instead of Delta')
    expect(between(html, 'data-system-post-preview', '</p>')).toContain(
      'Schedule remixed by chris: 1 of 3 regular-season weeks regenerated (weeks 3), 4 team-week pairings changed.',
    )
    expect(openTagOf(html, 'data-confirm-remix')).not.toMatch(/ disabled=""/)
    expect(html).not.toContain('data-confirm-gate')
  })

  it('OVERRIDE (E41 after kickoff, D290): the override copy, the reason field OFFERED as optional, and Confirm OPEN with an empty reason — even when the preview still answers `reason_required: true` (Q66 / F363(c) / R1056)', () => {
    // OVERRIDE_PLAN deliberately carries `reason_required: true`: a database
    // that has not received migration 132 yet still says so, and no UI may
    // block on an empty reason because of it.
    const html = renderRemix({ data: OVERRIDE_PLAN })
    expect(html).toContain('data-window="override"')
    expect(html).toContain(OVERRIDE_WINDOW_TITLE)
    expect(html).toContain('A reason is optional')
    expect(html).not.toContain('a reason is required')
    expect(html).toContain('data-remix-reason')
    expect(html).toContain('Reason (optional')
    expect(openTagOf(html, 'data-confirm-remix')).not.toMatch(/ disabled=""/)
    expect(html).not.toContain('data-confirm-gate')
    const post = between(html, 'data-system-post-preview', '</p>')
    expect(post).toContain('commissioner override')
    expect(post).not.toContain('reason:')
  })

  it('an identical seed is an explicit no-changes state with Confirm disabled', () => {
    const html = renderRemix({ data: { ...PLAN, no_changes: true, change_count: 0, diff: [] } })
    expect(html).toContain('nothing would change')
    expect(between(html, 'data-confirm-gate', '</span>')).toContain(NO_CHANGES_COPY)
  })

  it('a confirm refusal renders the RPC’s sentence VERBATIM over the kept plan — never optimistic', () => {
    const refusal = 'schedule_remix_confirm: seed 20990117 is already this league’s schedule — nothing to regenerate (R731)'
    const html = renderRemix({ data: PLAN }, { isError: true, error: new Error(refusal) })
    expect(html).toContain(refusal)
    expect(html).toContain('role="alert"')
    expect(html).toContain('data-side-by-side')
    expect(html).not.toContain('data-remix-applied')
  })

  it('applied: the server’s result and the D97 post exactly as written; Done', () => {
    const result: RemixConfirmResult = {
      league_id: LEAGUE,
      season: 2099,
      action_id: 'a',
      schedule_seed: 20990117,
      previous_seed: 1,
      first_week: 1,
      regular_season_weeks: 3,
      window: PLAN.window,
      reason_required: false,
      weeks_regenerated: [3],
      weeks_frozen: PLAN.weeks_frozen,
      matchups_replaced: 4,
      change_count: 4,
      no_changes: false,
      diff: PLAN.diff,
      system_post: 'Schedule remixed by chris: 1 of 3 regular-season weeks regenerated (weeks 3), 4 team-week pairings changed.',
    }
    const html = renderRemix({ data: PLAN }, { data: result })
    expect(html).toContain('data-remix-applied')
    expect(html).toContain('Weeks 3 regenerated')
    expect(between(html, 'data-system-post', '</p>')).toContain(result.system_post)
    expect(html).toContain('Done')
    expect(html).not.toContain('data-confirm-remix')
  })
})

// ---------------------------------------------------------------------------
// The DOOR pin — F322/C65's shape ("the server has the verb, the UI has no
// door"). `set_lineup` has accepted a commissioner acting for another
// franchise since migration 114, and for a while nothing in the app linked
// to any team but the viewer's own. These assert the anchors exist.
// ---------------------------------------------------------------------------

describe('every franchise on screen is a door to its own team page (§16.1)', () => {
  it('the standings table links all four rows, each to its OWN id', () => {
    const html = renderStandings()
    for (const id of ['t1', 't2', 't3', 't4']) {
      expect(html, id).toContain(`data-team-link="${id}"`)
      expect(html, id).toContain(`href="/app/leagues/${LEAGUE}/team/${id}"`)
    }
    // The link's accessible name is the FRANCHISE (the crest stays outside
    // the anchor, so its initials are not announced as part of the name).
    expect(html).toMatch(/<a[^>]*data-team-link="t3"[^>]*>Charlie<\/a>/)
    // The door carries no resting elevation — hover paints the underline
    // (CLAUDE.md), which matters most on the viewer's OWN row, where the
    // table's row wash is deliberately suppressed.
    const own = openTagOf(html, 'data-team-link="t1"')
    expect(own).not.toContain('shadow-hard')
    expect(own).toContain('hover:decoration-current')
  })

  it('the schedule links BOTH sides of a pairing', () => {
    const html = renderSchedule()
    expect(html).toContain(`href="/app/leagues/${LEAGUE}/team/t1"`)
    expect(html).toContain(`href="/app/leagues/${LEAGUE}/team/t2"`)
  })
})

// ---------------------------------------------------------------------------
// Elevation (CLAUDE.md) — the feature files, since ui/’s pin stops at ui/
// ---------------------------------------------------------------------------

const RESTING_SHADOW = /(?<![\w-])(?<!:)shadow-hard-[\w-]+/g
const INTERACTION_PREFIX = /(hover|active|focus|focus-visible|group-hover|peer-hover|data-\[[^\]]*\]):$/

function restingShadowsIn(source: string): string[] {
  const hits: string[] = []
  for (const match of source.matchAll(RESTING_SHADOW)) {
    const before = source.slice(Math.max(0, match.index - 40), match.index)
    if (INTERACTION_PREFIX.test(before)) continue
    const line = source.slice(source.lastIndexOf('\n', match.index) + 1, match.index)
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue
    hits.push(match[0])
  }
  return hits
}

const FILES = [
  'standings-table.tsx',
  'standings-page.tsx',
  'standings-table-ops.ts',
  'schedule-view.tsx',
  'schedule-view-ops.ts',
  'schedule-remix-modal.tsx',
]

describe('elevation is a hover affordance, never a resting one — the L.D5.3 files', () => {
  const read = (f: string) => readFileSync(path.resolve(process.cwd(), 'src/components/leagues', f), 'utf8')

  it('no feature file carries a resting shadow — the Remix dialog’s is the primitive’s (a true overlay, ui/dialog.tsx)', () => {
    for (const f of FILES) {
      expect(restingShadowsIn(read(f)), f).toEqual([])
    }
    // …and the modal really does mount the primitive that carries it.
    expect(read('schedule-remix-modal.tsx')).toContain('<DialogContent')
  })

  it('no dark: variants, no next-themes (single theme); no clock (§23.3 / F226)', () => {
    for (const f of FILES) {
      const src = read(f)
      expect(src, f).not.toMatch(/\bdark:/)
      expect(src, f).not.toContain('next-themes')
      expect(src, f).not.toMatch(/Date\.now\(\)|new Date\(\)/)
    }
  })
})
