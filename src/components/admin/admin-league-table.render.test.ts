/**
 * The admin all-leagues table and the league page's Members / Settings
 * sections (migration 193; F599) over real payload shapes — the table with
 * its true total, sort marks, usernames as profile links, deleted badge,
 * overflow paging; empty; the detail's vacant / autopilot / record and the
 * stated record error; loading and the named pre-push 503. Plus the pure
 * helpers. `renderToStaticMarkup`, as the other render tests.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({ usePathname: () => '/app/admin/leagues', useRouter: () => ({ push: () => {} }) }))

import { AdminApiError } from '@/lib/admin/admin-api'
import {
  canBeMadeCommissioner,
  commissionerBeforeAfter,
  LEAGUE_TABLE_UNAVAILABLE,
  leagueTableUrl,
  setCommissionerUrl,
  pageWords,
  recordWords,
  type OpLeagueDetail,
  type OpLeagueList,
  type OpLeagueRow,
} from '@/lib/admin/league-table'

import { LeagueDetailBody, LeagueTableBody, rawSettings } from './admin-league-table'
import { AdminError, AdminLoading } from './admin-parts'

const html = (el: ReactElement) =>
  renderToStaticMarkup(createElement(QueryClientProvider, { client: new QueryClient() }, el))
const noop = () => {}

const row: OpLeagueRow = {
  id: '5f0e8f43-0e7b-4a4c-a0f2-6f4a8a1f2c33',
  name: 'Sunday Funday',
  status: 'in_season',
  phase: 'In season',
  season: 2026,
  created_at: '2026-08-01T12:00:00Z',
  deleted_at: null,
  commissioner_id: 'u1',
  commissioner: 'chris',
  team_count: 10,
  members: 9,
  teams: 10,
  vacant_seats: 1,
  open_seats: 1,
  draft: { id: 'd1', type: 'auction', status: 'complete', summary: 'Auction draft — done' },
  current_week: { week: 6, status: 'live', summary: 'Week 6 — being played' },
  settings_summary: {
    scoring: 'Preset: ESPN Standard', roster_size: 16, roster: '9 starters, 6 bench, 1 IR',
    waivers: 'Rolling priority', trade_review: 'Commissioner reviews', trade_deadline: 'After week 10',
    playoffs: '6 teams from week 15', season_length: '14 regular-season weeks', schedule: 'Head to head',
  },
}
const list: OpLeagueList = {
  as_of: '2026-10-15T12:00:00Z', q: '', sort: 'created', desc: true, include_deleted: false,
  total: 1, limit: 50, offset: 0, more: false, leagues: [row],
}
const table = (l: OpLeagueList) =>
  html(createElement(LeagueTableBody, { list: l, sort: 'created', dir: 'desc', onSort: noop, onOpen: noop, onPage: noop }))

describe('All-leagues table', () => {
  it('renders every column in plain words, the true total, the commissioner as a profile link, the row opening the admin league', () => {
    const out = table(list)
    expect(out).toContain('data-league-total="1"')
    expect(out).toContain('Showing 1–1 of 1')
    expect(out).toContain(`href="/app/admin/leagues/${row.id}"`)
    expect(out).toContain('href="/u/chris"')
    for (const words of ['In season', 'Auction draft — done', 'Week 6 — being played', 'Preset: ESPN Standard', 'Rolling priority', 'Commissioner reviews', '6 teams from week 15']) {
      expect(out).toContain(words)
    }
    expect(out).toContain('aria-sort="descending"')
    expect(out).not.toContain('data-overflow')
    expect(out).not.toContain('data-archived')
  })

  it('overflow: a cut page says so with the true total and pages on', () => {
    const out = table({ ...list, total: 240, more: true, leagues: Array.from({ length: 50 }, (_, i) => ({ ...row, id: `id-${i}` })) })
    expect(out).toContain('Showing 1–50 of 240')
    expect(out).toContain('data-overflow="league-table"')
    expect(out).toContain('240 in all')
  })

  it('an archived league carries its badge (212 / F716 — deleted_at is the archived-at stamp)', () => {
    const out = table({ ...list, include_deleted: true, leagues: [{ ...row, deleted_at: '2026-09-01T12:00:00Z' }] })
    expect(out).toContain('data-archived')
    expect(out).toMatch(/Archived Sep 1/)
    expect(out).toContain('(archived included)')
    expect(out).not.toMatch(/[Dd]eleted/)
  })

  it('empty: no leagues, and a search with no match, are said in words', () => {
    expect(table({ ...list, total: 0, leagues: [] })).toContain('There are no leagues yet.')
    expect(table({ ...list, q: 'zzz', total: 0, leagues: [] })).toContain('No league or commissioner matches “zzz”.')
  })

  it('loading and the named pre-push 503 (no retry button)', () => {
    expect(html(createElement(AdminLoading, { rows: 6, label: 'league-table' }))).toContain('data-admin-loading="league-table"')
    const out = html(createElement(AdminError, { error: new AdminApiError(503, LEAGUE_TABLE_UNAVAILABLE), what: 'the leagues', onRetry: noop }))
    expect(out).toContain('data-admin-error="unavailable"')
    expect(out).toContain('migration 193 is not pushed')
    expect(out).not.toContain('Retry')
  })
})

const detail: OpLeagueDetail = {
  as_of: '2026-10-15T12:00:00Z',
  league: row,
  settings: {
    format: 'redraft', waiver_type: 'rolling_priority', faab_budget: 100, trade_deadline_week: null,
    roster_settings: { bench: 6 }, settings: { median_game: true },
  },
  record_error: null,
  members: [
    { member_id: 'm1', team_id: 't1', team_name: 'Aces', team_status: 'active', user_id: 'u1', username: 'chris', role: 'commissioner', joined_at: '2026-08-01T12:00:00Z', vacant: false, autopilot: false, record: { wins: 4, losses: 1, ties: 0, rank: 1, points_for: 600 } },
    { member_id: 'm2', team_id: 't2', team_name: 'Bees', team_status: 'active', user_id: 'u2', username: 'jason', role: 'manager', joined_at: '2026-08-02T12:00:00Z', vacant: false, autopilot: true, record: { wins: 2, losses: 2, ties: 1, rank: 2, points_for: 500 } },
    { member_id: 'm3', team_id: 't3', team_name: 'Open Seat', team_status: 'active', user_id: null, username: null, role: 'manager', joined_at: null, vacant: true, autopilot: false, record: null },
  ],
}

describe('League page: Members and Settings', () => {
  it('lists every seat: usernames link to profiles, role, vacant, autopilot, record', () => {
    const out = html(createElement(LeagueDetailBody, { detail }))
    expect(out).toContain('data-admin-section="league-members"')
    expect(out).toContain('href="/u/chris"')
    expect(out).toContain('href="/u/jason"')
    expect(out).toContain('Commissioner')
    expect(out).toContain('data-vacant')
    expect(out).toContain('data-autopilot')
    expect(out).toContain('4-1')
    expect(out).toContain('2-2-1')
    expect(out).not.toContain('data-record-error')
  })

  it('settings: the plain summary and every stored setting', () => {
    const out = html(createElement(LeagueDetailBody, { detail }))
    expect(out).toContain('data-admin-section="league-settings"')
    expect(out).toContain('16 spots — 9 starters, 6 bench, 1 IR')
    expect(out).toContain('median_game')
    expect(rawSettings(detail).map(([k]) => k)).toEqual(['format', 'waiver_type', 'faab_budget', 'trade_deadline_week', 'median_game', 'roster_settings'])
  })

  it('a record that could not be read is stated, never shown as 0-0', () => {
    const out = html(createElement(LeagueDetailBody, { detail: { ...detail, record_error: 'The league is deleted, so it has no standings.', members: detail.members.map((m) => ({ ...m, record: null })) } }))
    expect(out).toContain('data-record-error')
    expect(out).not.toContain('0-0')
    // 212 (F716): the read's "deleted" sentence reads as what it means now.
    expect(out.replace(/&#x27;|&rsquo;/g, '’')).toContain('The league is archived, so its standings aren’t shown.')
  })

  it('a league with no members says so', () => {
    expect(html(createElement(LeagueDetailBody, { detail: { ...detail, members: [] } }))).toContain('No one has joined this league.')
  })
})

describe('League page: Make commissioner (F750, migration 208)', () => {
  const withCo: OpLeagueDetail = {
    ...detail,
    members: [
      ...detail.members,
      { member_id: 'm4', team_id: 't4', team_name: 'Cats', team_status: 'active', user_id: 'u4', username: 'sam', role: 'co_commissioner', joined_at: '2026-08-03T12:00:00Z', vacant: false, autopilot: false, record: null },
    ],
  }

  it('offers the control to every person who is not the commissioner — a manager and a co-commissioner, never the commissioner or an open seat', () => {
    const out = html(createElement(LeagueDetailBody, { detail: withCo, onConfirm: noop }))
    expect(out).toContain('data-make-commissioner="m2"')
    expect(out).toContain('data-make-commissioner="m4"')
    expect(out).not.toContain('data-make-commissioner="m1"')
    expect(out).not.toContain('data-make-commissioner="m3"')
    expect(out.match(/>Make commissioner</g)?.length).toBe(2)
  })

  it('no control without the confirm dialog, and none in a deleted league', () => {
    expect(html(createElement(LeagueDetailBody, { detail: withCo }))).not.toContain('data-make-commissioner')
    const deleted = { ...withCo, league: { ...row, deleted_at: '2026-09-01T00:00:00Z' } }
    expect(html(createElement(LeagueDetailBody, { detail: deleted, onConfirm: noop }))).not.toContain('data-make-commissioner')
  })

  it('the dialog words: Now / After in plain words, the old commissioner stays a co-commissioner with his team', () => {
    expect(commissionerBeforeAfter(withCo.members[1], withCo.members)).toEqual({
      before: 'chris is the commissioner. jason is a manager.',
      after: 'jason is the commissioner. chris is a co-commissioner and keeps their team. The league sees “FieldScout made jason the commissioner. chris is now a co-commissioner.”',
    })
    expect(commissionerBeforeAfter(withCo.members[3], withCo.members).before).toBe('chris is the commissioner. sam is a co-commissioner.')
    const headless = withCo.members.filter((m) => m.role !== 'commissioner')
    expect(commissionerBeforeAfter(headless[0], headless)).toEqual({
      before: 'This league has no commissioner. jason is a manager.',
      after: 'jason is the commissioner. The league sees “FieldScout made jason the commissioner.”',
    })
  })

  it('who can be made the commissioner, and the route', () => {
    const [m1, m2, m3, m4] = withCo.members
    expect([m1, m2, m3, m4].map((m) => canBeMadeCommissioner(m, row))).toEqual([false, true, false, true])
    expect(canBeMadeCommissioner(m2, { deleted_at: '2026-09-01T00:00:00Z' })).toBe(false)
    expect(setCommissionerUrl(row.id)).toBe(`/api/admin/leagues/${row.id}/commissioner`)
  })
})

describe('helpers', () => {
  it('leagueTableUrl, pageWords, recordWords', () => {
    expect(leagueTableUrl({ q: 'a b', sort: 'name', dir: 'asc', offset: 50, deleted: true })).toBe(
      '/api/admin/leagues?q=a+b&sort=name&dir=asc&offset=50&limit=50&deleted=1',
    )
    expect(pageWords({ offset: 50, total: 51, leagues: [row] })).toBe('Showing 51–51 of 51')
    expect(pageWords({ offset: 0, total: 0, leagues: [] })).toBe('No leagues')
    expect(recordWords(null)).toBe('—')
  })
})
