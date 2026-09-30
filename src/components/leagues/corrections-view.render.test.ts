/**
 * corrections-view.render.test.ts — L.E2.4's render proof per state, over
 * REAL renders (spec §23.4 / §16.5.2; tasks-M6 §6 L.E2.4 read through Q81;
 * PROGRESS D456, F477 / F527).
 *
 * The `matchup-view.render.test.ts` rig: `renderToStaticMarkup` over the
 * actual components with the React Query cache pre-seeded (fetches are
 * effects, and effects do not run in a static render, so the cache IS the
 * data); `useLeagueChannel` is a spy so a cell can put the room in
 * `reconnecting`.
 *
 * States: loading · empty week (the server's sentence) · error-with-retry ·
 * degraded (last-good rows + the banner) · pre-push (the named 503's
 * sentence) · items in words · "Show older" · the page's gate. Then the
 * matchup page's change note (score / result / none / pre-push hidden /
 * failed read said) and the box's points note on a final week (F477).
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { leagueBoxKeys } from '@/hooks/use-box-score'
import type { LeagueDetail } from '@/hooks/use-league'
import { useLeagueChannel } from '@/hooks/use-league-channel'
import { leaguesKeys } from '@/hooks/use-leagues'
import { leagueMatchupKeys } from '@/hooks/use-matchups'
import { scheduleKeys, type LeagueSchedule } from '@/hooks/use-schedule'
import { statCorrectionsKeys, type StatCorrectionsFilters, type StatCorrectionsState } from '@/hooks/use-stat-corrections'
import type { TeamBoxScore } from '@/lib/leagues/api/box-score-service'
import { CORRECTIONS_UNAVAILABLE_MESSAGE } from '@/lib/leagues/api/corrections-copy'
import type { StatCorrectionItem, StatCorrectionsPage } from '@/lib/leagues/api/corrections-service'
import type { WeekMatchups } from '@/lib/leagues/api/matchups-service'
import { defaultsForTeamCount } from '@/lib/leagues/settings/league-settings'

import { CorrectionsPage, CorrectionsView } from './corrections-view'
import {
  BOX_FINAL_STORED_COPY,
  CORRECTIONS_INTRO_COPY,
  CORRECTIONS_PROBLEM_COPY,
  CORRECTIONS_SHOW_OLDER_LABEL,
  MATCHUP_NOTE_PROBLEM_COPY,
  MATCHUP_NOTE_RESULT_TITLE,
  MATCHUP_NOTE_SCORE_TITLE,
  RESULT_NOT_YET_COPY,
} from './corrections-view-ops'
import { MatchupPage } from './matchup-view'
import { RECONNECTING_COPY, STALE_SCORES_COPY } from './status-banners'

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ user: { id: 'user-commish' }, profile: { username: 'chris' } }),
}))
vi.mock('@/hooks/use-league-channel', () => ({
  useLeagueChannel: vi.fn(() => ({ connection: 'live' })),
}))

// ---------------------------------------------------------------------------
// Rig
// ---------------------------------------------------------------------------

const LEAGUE = 'league-1'
const T1 = 'aaaaaaaa-0000-4000-8000-000000000001'
const T2 = 'aaaaaaaa-0000-4000-8000-000000000002'
const T3 = 'aaaaaaaa-0000-4000-8000-000000000003'
const NAMES = new Map([
  [T1, 'Alpha'],
  [T2, 'Bravo'],
  [T3, 'Charlie'],
])

const DETAIL: LeagueDetail = {
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
  settings: { ...defaultsForTeamCount(8), regular_season_weeks: 3 },
  members: [
    { id: 'm1', user_id: 'user-commish', team_id: T1, role: 'commissioner', is_placeholder: false, is_autodraft: false, joined_at: null, profiles: null },
    { id: 'm2', user_id: 'user-manager', team_id: T2, role: 'manager', is_placeholder: false, is_autodraft: false, joined_at: null, profiles: null },
  ],
  teams: [...NAMES.entries()].map(([id, name]) => ({ id, name, owner_id: 'user-commish', status: 'active', created_at: null })),
  my_role: 'manager',
  active_draft: null,
}

const SCHEDULE: LeagueSchedule = {
  weeks: [
    { id: 'w1', season: 2099, week: 1, status: 'final', finalized_at: '2099-09-15T12:05:00Z', median_score: null },
    { id: 'w2', season: 2099, week: 2, status: 'correction_window', finalized_at: null, median_score: null },
    { id: 'w3', season: 2099, week: 3, status: 'upcoming', finalized_at: null, median_score: null },
  ],
  matchups: [
    { id: 'm1', season: 2099, week: 1, round_type: 'regular', status: 'final', home_team_id: T1, away_team_id: T2, home_score: 100.6, away_score: 101, result: 'away', is_overridden: false },
  ],
}

function item(over: Partial<StatCorrectionItem> = {}): StatCorrectionItem {
  return {
    id: 'c1',
    week: 1,
    recorded_at: '2099-09-14T15:00:00Z',
    player: { id: 'p1', name: 'Lou Receiver', position: 'WR', nfl_team: 'AAA' },
    team: { id: T1, name: 'Alpha' },
    matchup_id: 'm1',
    slot: 'wr:0',
    stat_changes: [{ stat_key: 'receiving_yards', stat: 'receiving yards', old: 100, new: 94, words: 'receiving yards 100 → 94' }],
    player_points: { before: 10, after: 9.4 },
    team_score: { before: 101.2, after: 100.6 },
    result: { known: true, changed: true, changes: [{ game: 'matchup', before: 'win', after: 'loss', words: 'Matchup: win → loss' }] },
    summary: 'Lou Receiver’s receiving yards 100 → 94 — Alpha 101.20 → 100.60',
    ...over,
  }
}

function page(over: Partial<StatCorrectionsPage> = {}): StatCorrectionsState {
  return { state: 'known', page: { week: null, items: [], limit: 50, has_more: false, next_cursor: null, note: null, ...over } }
}

type CorrectionsSeed = StatCorrectionsState[] | 'error' | { degraded: StatCorrectionsState[] } | 'missing'

function client(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false, retryOnMount: false } } })
}

function failQuery(qc: QueryClient, queryKey: readonly unknown[], error: Error, data?: unknown) {
  const query = qc.getQueryCache().build(qc, { queryKey })
  if (data !== undefined) query.setData(data)
  query.setState({ status: 'error', error, fetchStatus: 'idle' })
}

function seedCorrections(qc: QueryClient, filters: StatCorrectionsFilters, seed: CorrectionsSeed) {
  const key = statCorrectionsKeys.list(LEAGUE, filters)
  const infinite = (pages: StatCorrectionsState[]) => ({ pages, pageParams: pages.map((_, i) => (i === 0 ? undefined : `cursor-${i}`)) })
  if (seed === 'missing') return
  if (seed === 'error') failQuery(qc, key, new Error('stat corrections read failed'))
  else if (Array.isArray(seed)) qc.setQueryData(key, infinite(seed))
  else failQuery(qc, key, new Error('refetch failed'), infinite(seed.degraded))
}

function render(qc: QueryClient, element: React.ReactElement): string {
  return renderToStaticMarkup(createElement(QueryClientProvider, { client: qc }, element))
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
}

function renderView(seed: CorrectionsSeed, opts: { week?: number | null; connection?: 'live' | 'reconnecting' } = {}): string {
  const qc = client()
  qc.setQueryData(scheduleKeys.all(LEAGUE), SCHEDULE)
  const week = opts.week ?? null
  seedCorrections(qc, week === null ? {} : { week }, seed)
  vi.mocked(useLeagueChannel).mockReturnValue({ connection: opts.connection ?? 'live' })
  return render(qc, createElement(CorrectionsView, { leagueId: LEAGUE, initialWeek: week, leagueTimeZone: 'America/New_York' }))
}

/** The list state the view claims (`data-corrections-state`), or null. */
function stateOf(html: string): string | null {
  return /data-corrections-state="([a-z]+)"/.exec(html)?.[1] ?? null
}

// ---------------------------------------------------------------------------
// The view, per state
// ---------------------------------------------------------------------------

describe('the corrections view — every state', () => {
  it('loading: the skeleton, and no state claimed', () => {
    const html = renderView('missing')
    expect(html).toContain('data-skeleton="corrections"')
    expect(stateOf(html)).toBeNull()
  })

  it('an empty week says so in the server’s words — never a blank list', () => {
    const note = 'No stat correction changed a score in this league in Week 2.'
    const html = renderView([page({ week: 2, note })], { week: 2 })
    expect(stateOf(html)).toBe('empty')
    expect(html).toContain(note)
    expect(html).not.toContain('data-correction=')
  })

  it('error: the problem and a retry — never the empty copy', () => {
    const html = renderView('error')
    expect(stateOf(html)).toBe('error')
    expect(html).toContain(CORRECTIONS_PROBLEM_COPY)
    expect(html).toContain('Retry')
    expect(html).toContain('role="alert"')
  })

  it('degraded: the last-good rows stay, behind the stale banner', () => {
    const html = renderView({ degraded: [page({ items: [item()] })] })
    expect(html).toContain(STALE_SCORES_COPY)
    expect(stateOf(html)).toBe('items')
    expect(html).toContain('Lou Receiver')
  })

  it('pre-push (a database without 172): the server’s named sentence — not an error, not an empty list', () => {
    const html = renderView([{ state: 'unavailable', reason: CORRECTIONS_UNAVAILABLE_MESSAGE }])
    expect(stateOf(html)).toBe('unavailable')
    expect(html).toContain(CORRECTIONS_UNAVAILABLE_MESSAGE)
    expect(html).not.toContain('role="alert"')
  })

  it('items: each correction in words — player, stat, old → new, team, his points and the team score, the result', () => {
    const html = renderView([page({ items: [item(), item({ id: 'c2', result: { known: false, changed: false, changes: [] } })] })])
    expect(stateOf(html)).toBe('items')
    expect(html).toContain('Receiving yards 100 → 94')
    expect(html).not.toContain('receiving_yards')
    expect(html).toContain('His points 10.00 → 9.40')
    expect(html).toContain('Team score 101.20 → 100.60')
    expect(html).toContain(`data-team-link="${T1}"`)
    expect(html).toContain('Result changed')
    expect(html).toContain('Matchup: win → loss')
    expect(html).toContain('data-result-tone="not_yet"')
    expect(html).toContain(RESULT_NOT_YET_COPY)
    expect(html).toContain(CORRECTIONS_INTRO_COPY)
  })

  it('"Show older" only while the server says there is more', () => {
    expect(renderView([page({ items: [item()], has_more: true, next_cursor: 'tok' })])).toContain(CORRECTIONS_SHOW_OLDER_LABEL)
    expect(renderView([page({ items: [item()] })])).not.toContain(CORRECTIONS_SHOW_OLDER_LABEL)
  })

  it('the room dropping says so (the list refreshes on the door’s post — F527)', () => {
    expect(renderView([page({ items: [item()] })], { connection: 'reconnecting' })).toContain(RECONNECTING_COPY.split('—')[0].trim())
  })

  it('no resting elevation on anything the view draws (CLAUDE.md)', () => {
    const html = renderView([page({ items: [item()], has_more: true, next_cursor: 'tok' })])
    expect(html).not.toMatch(/(?<![a-z-]:)shadow-hard/)
  })
})

describe('the stand-alone page — the membership gate first', () => {
  it('a league that will not load is the family’s problem card', () => {
    const qc = client()
    failQuery(qc, leaguesKeys.detail(LEAGUE), new Error('League not found'))
    const html = render(qc, createElement(CorrectionsPage, { leagueId: LEAGUE }))
    expect(html).toContain('Couldn’t load this league.')
    expect(html).not.toContain('data-corrections-view')
  })

  // (The header and its door back to the league are `PageHeader`'s — an effect into the shell's
  // header store, which a static render does not run.)
  it('a member sees the view, opened on the linked week', () => {
    const qc = client()
    qc.setQueryData(leaguesKeys.detail(LEAGUE), DETAIL)
    qc.setQueryData(scheduleKeys.all(LEAGUE), SCHEDULE)
    seedCorrections(qc, { week: 1 }, [page({ week: 1, items: [item()] })])
    const html = render(qc, createElement(CorrectionsPage, { leagueId: LEAGUE, initialWeek: 1 }))
    expect(html).toContain('Stat corrections')
    expect(html).toContain('data-corrections-view')
    expect(html).toContain('Receiving yards 100 → 94')
  })
})

// ---------------------------------------------------------------------------
// The matchup page — the change note and the box's points note
// ---------------------------------------------------------------------------

function weekDoc(status: string): WeekMatchups {
  return {
    league_id: LEAGUE,
    season: 2099,
    week: 1,
    schedule_mode: 'h2h',
    league_week: { status, median_score: null, finalized_at: null },
    teams: [...NAMES.entries()].map(([id, name]) => ({ id, name, status: 'active' })),
    matchups: [
      { id: 'm1', season: 2099, week: 1, round_type: 'regular', status: 'final', home_team_id: T1, away_team_id: T2, home_score: 100.6, away_score: 101, result: 'away', is_overridden: false, updated_at: null },
    ],
    results: [],
  }
}

function box(teamId: string, over: Partial<TeamBoxScore> = {}): TeamBoxScore {
  return {
    league_id: LEAGUE,
    season: 2099,
    week: 1,
    team_id: teamId,
    lineup: { locked_at: '2099-09-13T17:00:00Z', set_at: '2099-09-12T10:00:00Z', edited_by_commish: false },
    starters: [
      {
        slot: 'wr:0',
        slot_key: 'wr',
        label: 'WR',
        player: { id: 'p1', full_name: 'Lou Receiver', position: 'WR', nfl_team: 'AAA' },
        phase: 'done',
        game: null,
        points: 12,
        pending: [],
        reason: 'scored',
        line: { rec_yards: 80 } as TeamBoxScore['starters'][number]['line'],
      },
    ],
    points: 12,
    pending: [],
    no_stat_row: [],
    no_game_rows: false,
    points_source: 'stored',
    stored_source: 'worker',
    stored_note: null,
    ...over,
  }
}

function renderMatchup(corrections: CorrectionsSeed, status = 'final'): string {
  const qc = client()
  qc.setQueryData(leaguesKeys.detail(LEAGUE), DETAIL)
  qc.setQueryData(scheduleKeys.all(LEAGUE), SCHEDULE)
  qc.setQueryData(leagueMatchupKeys.week(LEAGUE, 1), weekDoc(status))
  qc.setQueryData(leagueBoxKeys.team(LEAGUE, 1, T1), box(T1))
  qc.setQueryData(leagueBoxKeys.team(LEAGUE, 1, T2), box(T2))
  seedCorrections(qc, { week: 1, limit: 100 }, corrections)
  vi.mocked(useLeagueChannel).mockReturnValue({ connection: 'live' })
  return render(qc, createElement(MatchupPage, { leagueId: LEAGUE, matchupId: 'm1' }))
}

describe('the matchup page’s change note (§16.5.2)', () => {
  it('a correction that flipped the result: the result title, the record’s sentence, who it moved, the door to the week', () => {
    const html = renderMatchup([page({ week: 1, items: [item()] })])
    expect(html).toContain('data-correction-note="result"')
    expect(html).toContain(MATCHUP_NOTE_RESULT_TITLE)
    expect(html).toContain('Lou Receiver’s receiving yards 100 → 94 — Alpha 101.20 → 100.60')
    expect(html).toContain('Alpha — Matchup: win → loss')
    expect(html).toContain(`href="/app/leagues/${LEAGUE}/corrections?week=1"`)
  })

  it('a score-only change: the score title', () => {
    const html = renderMatchup([page({ week: 1, items: [item({ result: { known: true, changed: false, changes: [] } })] })])
    expect(html).toContain('data-correction-note="score"')
    expect(html).toContain(MATCHUP_NOTE_SCORE_TITLE)
  })

  it('no note when the week’s corrections touched other teams, or there are none', () => {
    expect(renderMatchup([page({ week: 1, items: [item({ team: { id: T3, name: 'Charlie' } })] })])).not.toContain('data-correction-note')
    expect(renderMatchup([page({ week: 1, note: 'No stat correction changed a score in this league in Week 1.' })])).not.toContain('data-correction-note')
  })

  it('pre-push hides the note (a section whose read is absent); a FAILED read says so, never "no corrections"', () => {
    expect(renderMatchup([{ state: 'unavailable', reason: CORRECTIONS_UNAVAILABLE_MESSAGE }])).not.toContain('data-correction-note')
    const failed = renderMatchup('error')
    expect(failed).toContain('data-correction-note="error"')
    expect(failed).toContain(MATCHUP_NOTE_PROBLEM_COPY)
  })

  it('an upcoming week never asks (and shows no note)', () => {
    expect(renderMatchup([page({ week: 1, items: [item()] })], 'upcoming')).not.toContain('data-correction-note')
  })
})

describe('the box score’s points note (F477)', () => {
  it('a FINAL week on the stored points says the stat line may have moved since', () => {
    const html = renderMatchup([page({ week: 1 })])
    expect(html).toContain('data-box-note')
    expect(html).toContain(BOX_FINAL_STORED_COPY)
  })

  it('a week still in its correction window says nothing (a fix there re-scores — line and points agree)', () => {
    const html = renderMatchup([page({ week: 1 })], 'correction_window')
    expect(html).not.toContain('data-box-note')
  })
})
