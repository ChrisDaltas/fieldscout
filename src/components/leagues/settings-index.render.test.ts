/**
 * League settings — index → detail (League Settings build, Chris 2026-10-04;
 * the prototype's SETTING_ROWS / SettingsRow / SubHead). Pure summaries in
 * `settings-index-ops`; REAL static renders of `SettingsPanel` for the
 * index (commissioner and manager), a detail section, and a locked
 * in-season section with its reason.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { commishSettingPolicyKeys, type SettingPolicies } from '@/hooks/use-commish-setting-policy'
import type { LeagueDetail } from '@/hooks/use-league'
import { leaguesKeys } from '@/hooks/use-leagues'
import { scoringTemplatesKeys } from '@/hooks/use-scoring-templates'
import { defaultsForTeamCount, type LeagueSettings } from '@/lib/leagues/settings/league-settings'
import { useOverrideMode } from '@/stores/commish-override-store'

import { indexRows, parseSettingsSection, settingsHref, type SettingsSection } from './settings-index-ops'
import { SettingsPanel } from './settings-panel'
import { settingPolicyKeys } from './settings-panel-ops'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  usePathname: () => '/app/leagues/league-1/settings',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ user: { id: 'u0' }, profile: { username: 'user0' } }),
}))
vi.mock('@/stores/commish-override-store', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/stores/commish-override-store')>()
  return { ...orig, useOverrideMode: vi.fn(orig.useOverrideMode) }
})

const LEAGUE = 'league-1'
const settings: LeagueSettings = defaultsForTeamCount(10)

const seat = (i: number, filled: boolean) => ({
  id: `m${i}`,
  user_id: filled ? `u${i}` : null,
  team_id: `t${i}`,
  role: i === 0 ? 'commissioner' : 'manager',
  is_placeholder: !filled,
  is_autodraft: false,
  joined_at: null,
  profiles: filled ? { username: `user${i}`, avatar_url: null } : null,
})

function detailFor(role: string, status = 'setup'): LeagueDetail {
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
    settings,
    members: Array.from({ length: 10 }, (_, i) => seat(i, i < 8)),
    teams: [],
    my_role: role,
    active_draft: null,
  } as LeagueDetail
}

function render(detail: LeagueDetail, section: SettingsSection | null, opts: { mode?: boolean; policies?: SettingPolicies } = {}): string {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, retryOnMount: false } } })
  qc.setQueryData(leaguesKeys.detail(LEAGUE), detail)
  qc.setQueryData(scoringTemplatesKeys.all, [{ id: 'tpl-ppr', name: 'ESPN Full PPR', description: null, rules: {} }])
  if (opts.policies) qc.setQueryData(commishSettingPolicyKeys.table(settingPolicyKeys(detail.settings)), opts.policies)
  vi.mocked(useOverrideMode).mockReturnValue(opts.mode ?? false)
  try {
    return renderToStaticMarkup(createElement(QueryClientProvider, { client: qc }, createElement(SettingsPanel, { leagueId: LEAGUE, section })))
      .replace(/&#x27;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&')
  } finally {
    vi.mocked(useOverrideMode).mockReset()
  }
}

/** The opening tag that carries `marker`. */
function tagWith(html: string, marker: string): string {
  const at = html.indexOf(marker)
  if (at < 0) return ''
  return html.slice(html.lastIndexOf('<', at), html.indexOf('>', at) + 1)
}

const fixed = (iso: string) => `AT ${iso}`

describe('indexRows — live one-line summaries from the stored settings', () => {
  it('teams: count and open spots, in plain words', () => {
    const rows = indexRows({ settings, filledSeats: 8, scoringName: 'ESPN Full PPR', scoringCustomized: false, formatDraftAt: fixed })
    expect(rows.map((r) => r.section)).toEqual(['teams', 'league', 'scoring', 'roster', 'draft', 'waivers'])
    expect(rows[0].note).toBe('10 teams · 2 open spots')
    const full = indexRows({ settings, filledSeats: 10, scoringName: null, scoringCustomized: false, formatDraftAt: fixed })
    expect(full[0].note).toBe('10 teams · every team has a manager')
  })

  it('scoring: the rulebook’s name, and a Custom chip for the league’s own copy', () => {
    const plain = indexRows({ settings, filledSeats: 0, scoringName: 'ESPN Full PPR', scoringCustomized: false, formatDraftAt: fixed })
    expect(plain[2]).toMatchObject({ note: 'ESPN Full PPR', chips: [] })
    const custom = indexRows({ settings, filledSeats: 0, scoringName: null, scoringCustomized: true, formatDraftAt: fixed })
    expect(custom[2]).toMatchObject({ note: 'Your league’s own custom scoring', chips: ['Custom'] })
  })

  it('roster: starters, bench, IR and the derived total (defaults: 10 + 6 + 1 = 17)', () => {
    const rows = indexRows({ settings, filledSeats: 0, scoringName: null, scoringCustomized: false, formatDraftAt: fixed })
    expect(rows[3].note).toBe('10 starters · 6 bench · 1 IR · 17 spots per team')
  })

  it('draft: type, then the scheduled instant or "not scheduled yet"', () => {
    const unscheduled = indexRows({ settings, filledSeats: 0, scoringName: null, scoringCustomized: false, formatDraftAt: fixed })
    expect(unscheduled[4].note).toBe('Snake draft · not scheduled yet')
    const at = '2099-09-01T20:00:00-04:00'
    const scheduled = indexRows({
      settings: { ...settings, draft: { ...settings.draft, draft_type: 'auction', draft_scheduled_at: at } },
      filledSeats: 0,
      scoringName: null,
      scoringCustomized: false,
      formatDraftAt: fixed,
    })
    expect(scheduled[4].note).toBe(`Auction draft · AT ${at}`)
  })

  it('waivers & trades: type, run days and time, deadline, review — FAAB chips only for FAAB', () => {
    const rows = indexRows({ settings, filledSeats: 0, scoringName: null, scoringCustomized: false, formatDraftAt: fixed })
    expect(rows[5].note).toBe('FAAB bidding · claims run Wed 3:00 AM · trade deadline week 11 · commissioner reviews trades')
    expect(rows[5].chips).toEqual(['FAAB', `$${settings.faab_budget}`])
    const fcfs = indexRows({
      settings: { ...settings, waiver_type: 'none_fcfs', trade_deadline_week: null, trade_review: 'league_vote' },
      filledSeats: 0,
      scoringName: null,
      scoringCustomized: false,
      formatDraftAt: fixed,
    })
    expect(fcfs[5].note).toBe('No waivers — first come, first served · no trade deadline · league votes on trades')
    expect(fcfs[5].chips).toEqual([])
  })

  it('?section= parses known sections only; anything else is the index', () => {
    expect(parseSettingsSection('scoring')).toBe('scoring')
    expect(parseSettingsSection(['draft', 'x'])).toBe('draft')
    expect(parseSettingsSection('commish')).toBeNull()
    expect(parseSettingsSection(undefined)).toBeNull()
    expect(settingsHref(LEAGUE, 'roster')).toBe('/app/leagues/league-1/settings?section=roster')
    expect(settingsHref(LEAGUE)).toBe('/app/leagues/league-1/settings')
  })
})

describe('the index page', () => {
  it('COMMISSIONER: one link row per section with its live summary, an Edit affordance, and the Commissioner tools row', () => {
    const html = render(detailFor('commissioner'), null)
    expect(html).toContain('data-settings-index')
    for (const s of ['teams', 'league', 'scoring', 'roster', 'draft', 'waivers']) {
      expect(tagWith(html, `data-settings-row="${s}"`)).toContain(`href="/app/leagues/${LEAGUE}/settings?section=${s}"`)
    }
    expect(html).toContain('10 teams · 2 open spots')
    expect(html).toContain('ESPN Full PPR')
    expect(html).toContain('10 starters · 6 bench · 1 IR · 17 spots per team')
    expect(html).toContain('> Edit<')
    expect(html).toContain('data-door="commish"')
    expect(html).toContain('Commissioner tools')
    // No form groups on the index, and no save bar while nothing is unsaved.
    expect(html).not.toContain('data-settings-fieldset')
    expect(html).not.toContain('All changes saved.')
    // Rows lift on hover only — never at rest.
    expect(html).not.toMatch(/class="[^"]*(?<![:-])shadow-hard-4/)
  })

  it('MANAGER: the same summaries, "View" not "Edit", the read-only notice, and NO Commissioner tools row', () => {
    const html = render(detailFor('manager'), null)
    expect(html).toContain('10 teams · 2 open spots')
    expect(html).toContain('>View<')
    expect(html).not.toContain('> Edit<')
    expect(html).not.toContain('data-door="commish"')
    expect(html).toContain('only the commissioner can change them')
  })
})

describe('a detail section', () => {
  it('COMMISSIONER, pre-draft: the SubHead back to the index, the section title, and an OPEN form holding only that section’s groups', () => {
    const html = render(detailFor('commissioner'), 'waivers')
    expect(html).toContain('data-settings-subhead')
    expect(tagWith(html, 'data-settings-back')).toContain(`href="/app/leagues/${LEAGUE}/settings"`)
    expect(html).toContain('Waivers & trades')
    expect(html).toContain('data-settings-fieldset="open"')
    expect(html).toContain('id="set-waiver-type"')
    expect(html).toContain('id="set-trade-review"')
    expect(html).not.toContain('id="set-teams"')
    expect(html).not.toContain('data-settings-index')
    expect(html).toContain('Save changes')
  })

  it('TEAMS: the members panel itself (the same InvitePanel the Members page mounts — no copy of it) and a link to the Members page', () => {
    const html = render(detailFor('commissioner'), 'teams')
    expect(html).toContain('Teams & members')
    expect(html).toContain('data-members-link')
    expect(html).toContain(`href="/app/leagues/${LEAGUE}/members"`)
    expect(html).not.toContain('data-settings-fieldset')
    expect(html).toContain('id="share-link"') // InvitePanel's own invite-link card
  })

  it('MANAGER: the section renders READ-ONLY (closed fieldset, no save bar)', () => {
    const html = render(detailFor('manager'), 'roster')
    expect(html).toContain('data-settings-fieldset="closed"')
    expect(html).not.toContain('Save changes')
  })

  it('IN SEASON, commissioner in override mode: a locked setting stays closed and SAYS WHY', () => {
    const why = 'The number of teams can’t change once the draft has happened.'
    const policies: SettingPolicies = Object.fromEntries(
      settingPolicyKeys(settings).map((key) => [
        key,
        key === 'team_count'
          ? { storage: 'column' as const, class: 'refused' as const, refused_why: why }
          : { storage: 'blob' as const, class: 'free' as const, refused_why: null },
      ]),
    )
    const html = render(detailFor('commissioner', 'in_season'), 'league', { mode: true, policies })
    expect(html).toContain('data-settings-fieldset="open"')
    const at = html.indexOf('id="set-teams"')
    expect(html.slice(html.lastIndexOf('<', at), html.indexOf('>', at))).toContain('disabled=""')
    expect(html).toContain(why)
  })
})
