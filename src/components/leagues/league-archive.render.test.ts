/**
 * League archive (F716 — Chris 2026-10-27: leagues are archived, never
 * deleted; the commissioner can restore. Migration 212). The gate and the
 * words (`league-archive-ops`), then REAL static renders: League settings'
 * danger zone per role and state (desktop's SettingsPanel and the phone's
 * danger zone), and the Leagues page's Archived leagues section (desktop and
 * phone) per role, empty and failed.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { MobileArchivedLeagues, MobileDangerZone } from '@/components/mobile/leagues/mobile-league-archive'
import type { LeagueDetail } from '@/hooks/use-league'
import { leaguesKeys, type ArchivedLeagueRow } from '@/hooks/use-leagues'
import { scoringTemplatesKeys } from '@/hooks/use-scoring-templates'
import { defaultsForTeamCount } from '@/lib/leagues/settings/league-settings'

import { ArchivedLeaguesSection } from './league-archive'
import {
  ARCHIVE_CO_COMMISH_REASON,
  ARCHIVE_DRAFT_REASON,
  ARCHIVE_MEMBER_REASON,
  ARCHIVE_TRADES_LINE,
  archiveConfirmLines,
  archivedOn,
  archiveGate,
  RESTORE_ONLY_COMMISH,
} from './league-archive-ops'
import { SettingsPanel } from './settings-panel'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  usePathname: () => '/app/leagues/league-1/settings',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ user: { id: 'u0' }, profile: { username: 'user0' } }),
}))

const LEAGUE = 'league-1'
const unescape = (html: string) => html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&')

function detailFor(role: string, status = 'in_season', draft: LeagueDetail['active_draft'] = null): LeagueDetail {
  return {
    league: {
      id: LEAGUE,
      name: 'Render League',
      avatar_url: null,
      description: null,
      season: 2099,
      status,
      owner_id: 'u0',
      scoring_system_id: 'tpl-ppr',
      invite_code: null,
      invite_slug: null,
      max_teams: 10,
      created_at: null,
      updated_at: null,
      champion_team_id: null,
    },
    settings: defaultsForTeamCount(10),
    members: [],
    teams: [],
    my_role: role,
    active_draft: draft,
  } as LeagueDetail
}

function render(element: ReactElement, seed: (qc: QueryClient) => void = () => {}): string {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, retryOnMount: false } } })
  seed(qc)
  return unescape(renderToStaticMarkup(createElement(QueryClientProvider, { client: qc }, element)))
}

function settingsIndex(detail: LeagueDetail): string {
  return render(createElement(SettingsPanel, { leagueId: LEAGUE, section: null }), (qc) => {
    qc.setQueryData(leaguesKeys.detail(LEAGUE), detail)
    qc.setQueryData(scoringTemplatesKeys.all, [{ id: 'tpl-ppr', name: 'ESPN Full PPR', description: null, rules: {} }])
  })
}

/** The opening tag that carries `marker`. */
function tagWith(html: string, marker: string): string {
  const at = html.indexOf(marker)
  if (at < 0) return ''
  return html.slice(html.lastIndexOf('<', at), html.indexOf('>', at) + 1)
}

const ROWS: ArchivedLeagueRow[] = [
  { id: 'a1', name: 'Old Commish League', avatar_url: null, season: 2026, status: 'in_season', team_count: 10, archived_at: '2026-10-27T12:00:00.000Z', my_role: 'commissioner' },
  { id: 'a2', name: 'Friends League', avatar_url: null, season: 2026, status: 'setup', team_count: 8, archived_at: '2026-10-20T12:00:00.000Z', my_role: 'manager' },
]

function archivedSection(element: ReactElement, seed: ArchivedLeagueRow[] | 'error'): string {
  return render(element, (qc) => {
    if (seed === 'error') {
      const query = qc.getQueryCache().build(qc, { queryKey: leaguesKeys.archived })
      query.setState({ status: 'error', error: new Error('boom'), fetchStatus: 'idle', data: undefined, dataUpdatedAt: 0 })
    } else {
      qc.setQueryData(leaguesKeys.archived, seed)
    }
  })
}

describe('archiveGate — the commissioner only, never mid-draft', () => {
  it('the commissioner archives, in every status but the draft', () => {
    for (const status of ['setup', 'scheduled', 'in_season', 'playoffs', 'complete']) {
      expect(archiveGate({ role: 'commissioner', status, draftStatus: status === 'scheduled' ? 'scheduled' : null })).toEqual({ kind: 'archive' })
    }
  })
  it('a draft in progress blocks it, with its reason (live, paused, or the league drafting)', () => {
    expect(archiveGate({ role: 'commissioner', status: 'drafting', draftStatus: 'live' })).toEqual({ kind: 'blocked', reason: ARCHIVE_DRAFT_REASON })
    expect(archiveGate({ role: 'commissioner', status: 'scheduled', draftStatus: 'paused' })).toEqual({ kind: 'blocked', reason: ARCHIVE_DRAFT_REASON })
    expect(archiveGate({ role: 'commissioner', status: 'drafting', draftStatus: null })).toEqual({ kind: 'blocked', reason: ARCHIVE_DRAFT_REASON })
  })
  it('a co-commissioner and a manager read why it is not theirs (F716)', () => {
    expect(archiveGate({ role: 'co_commissioner', status: 'in_season', draftStatus: null })).toEqual({ kind: 'not_commissioner', reason: ARCHIVE_CO_COMMISH_REASON })
    expect(archiveGate({ role: 'manager', status: 'in_season', draftStatus: null })).toEqual({ kind: 'not_commissioner', reason: ARCHIVE_MEMBER_REASON })
    expect(archiveGate({ role: null, status: 'in_season', draftStatus: null })).toEqual({ kind: 'not_commissioner', reason: ARCHIVE_MEMBER_REASON })
  })
  it('the confirm names the trades (R1727 / R1728), the in-season catch-up and the missed draft time only when they apply', () => {
    expect(archiveConfirmLines({ inSeason: false, draftScheduled: false })).toHaveLength(3)
    const season = archiveConfirmLines({ inSeason: true, draftScheduled: false })
    expect(season).toContain(ARCHIVE_TRADES_LINE)
    expect(ARCHIVE_TRADES_LINE).toMatch(/cancelled now/)
    expect(season.at(-1)).toMatch(/^When you restore it, anything that came due meanwhile/)
    expect(season.join(' ')).not.toMatch(/trade deadline expire/)
    expect(archiveConfirmLines({ inSeason: false, draftScheduled: true }).at(-1)).toMatch(/won’t start the draft/)
  })
  it('the date reads plainly', () => {
    expect(archivedOn('2026-10-27T12:00:00.000Z')).toBe('Archived Oct 27, 2026')
    expect(archivedOn('not a date')).toBe('Archived')
  })
})

describe('League settings › Danger zone (desktop)', () => {
  it('the commissioner gets Archive league', () => {
    const html = settingsIndex(detailFor('commissioner'))
    expect(tagWith(html, 'data-danger-zone')).toContain('data-archive-gate="archive"')
    expect(html).toContain('Danger zone')
    expect(html).toContain('data-archive-open')
    expect(tagWith(html, 'data-archive-open')).not.toMatch(/\sdisabled=""/)
    expect(html).not.toContain('data-archive-reason')
  })
  it('a co-commissioner sees the reason, never the button (prevent, don’t refuse)', () => {
    const html = settingsIndex(detailFor('co_commissioner'))
    expect(tagWith(html, 'data-danger-zone')).toContain('data-archive-gate="not_commissioner"')
    expect(html).toContain(ARCHIVE_CO_COMMISH_REASON)
    expect(html).not.toContain('data-archive-open')
  })
  it('a manager sees the reason, never the button', () => {
    const html = settingsIndex(detailFor('manager'))
    expect(html).toContain(ARCHIVE_MEMBER_REASON)
    expect(html).not.toContain('data-archive-open')
  })
  it('mid-draft the commissioner’s button is disabled, with why', () => {
    const html = settingsIndex(detailFor('commissioner', 'drafting', { id: 'd1', status: 'live', draft_type: 'snake', started_at: null, scheduled_at: null }))
    expect(tagWith(html, 'data-danger-zone')).toContain('data-archive-gate="blocked"')
    expect(tagWith(html, 'data-archive-open')).toMatch(/\sdisabled=""/)
    expect(html).toContain(ARCHIVE_DRAFT_REASON)
  })
})

describe('League settings › Danger zone (phone)', () => {
  it('the commissioner gets the Archive league row; others the reason', () => {
    const commish = render(createElement(MobileDangerZone, { leagueId: LEAGUE, detail: detailFor('commissioner') }))
    expect(commish).toContain('data-archive-open')
    expect(commish).not.toContain('data-archive-reason')
    const co = render(createElement(MobileDangerZone, { leagueId: LEAGUE, detail: detailFor('co_commissioner') }))
    expect(co).toContain(ARCHIVE_CO_COMMISH_REASON)
    expect(co).not.toContain('data-archive-open')
    const drafting = render(createElement(MobileDangerZone, { leagueId: LEAGUE, detail: detailFor('commissioner', 'drafting') }))
    expect(drafting).toContain(ARCHIVE_DRAFT_REASON)
    expect(drafting).not.toContain('data-archive-open')
  })
})

describe('Leagues › Archived leagues', () => {
  for (const [label, element] of [
    ['desktop', createElement(ArchivedLeaguesSection)],
    ['phone', createElement(MobileArchivedLeagues)],
  ] as const) {
    it(`${label}: each archived league, read-only; Restore only on the commissioner’s`, () => {
      const html = archivedSection(element, ROWS)
      expect(html).toContain('data-archived-leagues="shown"')
      expect(html).toContain('Archived leagues')
      const mine = html.slice(html.indexOf('data-archived-league="a1"'), html.indexOf('data-archived-league="a2"'))
      const theirs = html.slice(html.indexOf('data-archived-league="a2"'))
      expect(mine).toContain('Old Commish League')
      expect(mine).toContain('Archived Oct 27, 2026')
      expect(mine).toContain('data-restore-open')
      expect(theirs).toContain('Friends League')
      expect(theirs).toContain(RESTORE_ONLY_COMMISH)
      expect(theirs).not.toContain('data-restore-open')
      // Read-only: no link into an archived league's pages.
      expect(html).not.toContain('href="/app/leagues/a1')
      expect(html).not.toContain('href="/app/leagues/a2')
    })
    it(`${label}: nothing at all when there is none`, () => {
      expect(archivedSection(element, [])).toBe('')
    })
    it(`${label}: a failed read says so, with a retry — never an empty list it can’t vouch for`, () => {
      const html = archivedSection(element, 'error')
      expect(html).toContain('data-archived-leagues="error"')
      expect(html).toContain('role="alert"')
      expect(html).toContain('Couldn’t load your archived leagues.')
    })
  }
})
