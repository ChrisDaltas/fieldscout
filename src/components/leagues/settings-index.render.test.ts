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

import {
  indexRows,
  leavesSettings,
  parseSettingsSection,
  sectionErrors,
  sectionForField,
  SETTINGS_SECTIONS,
  settingsHref,
  type SettingsSection,
} from './settings-index-ops'
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

function detailFor(role: string, status = 'setup', s: LeagueSettings = settings): LeagueDetail {
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
    settings: s,
    members: Array.from({ length: 10 }, (_, i) => seat(i, i < 8)),
    teams: [],
    my_role: role,
    active_draft: null,
  } as LeagueDetail
}

function render(detail: LeagueDetail, section: SettingsSection | null, opts: { mode?: boolean; policies?: SettingPolicies; noTemplates?: boolean } = {}): string {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, retryOnMount: false } } })
  qc.setQueryData(leaguesKeys.detail(LEAGUE), detail)
  if (!opts.noTemplates) qc.setQueryData(scoringTemplatesKeys.all, [{ id: 'tpl-ppr', name: 'ESPN Full PPR', description: null, rules: {} }])
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

/** A stored settings object with ONE cross-section error: veto votes above
 *  the team count (the team-count edit in Season & playoffs that breaks a
 *  value only Waivers & trades shows — R1495's own example). */
const brokenVeto: LeagueSettings = { ...settings, trade_review: 'league_vote', trade_veto_votes: 12 }

describe('R1495 — an error is visible from every view, labelled by its section', () => {
  it('maps each error field to the section holding its control', () => {
    expect(sectionForField('trade_veto_votes')).toBe('waivers')
    expect(sectionForField('trade_deadline_week')).toBe('waivers')
    expect(sectionForField('team_count')).toBe('league')
    expect(sectionForField('playoff_start_week')).toBe('league')
    expect(sectionForField('roster_settings.bench')).toBe('roster')
    expect(sectionForField('draft.auction_budget')).toBe('draft')
    expect(sectionForField('scoring_system_id')).toBe('scoring')
    expect(sectionErrors([{ field: 'trade_veto_votes', message: 'm' }, { field: 'team_count', message: 'n' }]).map((e) => e.title)).toEqual([
      'Season & playoffs',
      'Waivers & trades',
    ])
  })

  it('viewing ANOTHER section (Draft): the save-bar list names Waivers & trades, links to it, and says what to fix', () => {
    const html = render(detailFor('commissioner', 'setup', brokenVeto), 'draft')
    expect(html).toContain('data-settings-errors')
    const li = html.slice(html.indexOf('data-settings-error="waivers"'))
    expect(li).toContain(`href="/app/leagues/${LEAGUE}/settings?section=waivers"`)
    expect(li).toContain('Waivers & trades</a>: Veto votes must be between 1 and the number of teams (10).')
    expect(html).not.toContain('data-settings-error="draft"')
  })

  it('the index marks the section that holds the error — and only that one', () => {
    const html = render(detailFor('commissioner', 'setup', brokenVeto), null)
    expect(html).toContain('data-settings-row-error="waivers"')
    for (const s of ['teams', 'league', 'scoring', 'roster', 'draft']) expect(html).not.toContain(`data-settings-row-error="${s}"`)
    expect(html).toContain('data-settings-error="waivers"')
  })

  it('a valid league shows no error list and no markers', () => {
    const html = render(detailFor('commissioner'), null)
    expect(html).not.toContain('data-settings-errors')
    expect(html).not.toContain('data-settings-row-error')
  })
})

describe('R1496 — every settings group renders in exactly one section', () => {
  const GROUP_SECTION: Record<string, SettingsSection> = {
    'Basic settings': 'league',
    Tiebreakers: 'league',
    'Roster & lineup slots': 'roster',
    'Lineups & lock': 'roster',
    Scoring: 'scoring',
    'Schedule the draft': 'draft',
    'Draft configuration': 'draft',
    'Waivers & free agency': 'waivers',
    Trades: 'waivers',
  }
  const titlesIn = (html: string) => [...html.matchAll(/data-settings-group="([^"]+)"/g)].map((m) => m[1])
  const views: (SettingsSection | null)[] = [null, ...SETTINGS_SECTIONS]
  const rendered = new Map(views.map((v) => [v, titlesIn(render(detailFor('commissioner'), v))]))

  it.each(Object.entries(GROUP_SECTION))('"%s" renders in %s and in no other view', (title, home) => {
    for (const v of views) {
      const count = rendered.get(v)!.filter((t) => t === title).length
      expect([v, count]).toEqual([v, v === home ? 1 : 0])
    }
  })

  it('no settings-form group renders that the table does not know', () => {
    for (const v of SETTINGS_SECTIONS) {
      const html = render(detailFor('commissioner'), v)
      for (const t of titlesIn(html)) {
        expect(GROUP_SECTION).toHaveProperty([t])
      }
    }
  })
})

describe('R1497 — leaving the settings page with unsaved edits asks first', () => {
  const here = `/app/leagues/${LEAGUE}/settings`
  const origin = 'https://fieldscout.test'
  it('section links stay on the page and never ask', () => {
    expect(leavesSettings(settingsHref(LEAGUE, 'waivers'), here, origin)).toBe(false)
    expect(leavesSettings(settingsHref(LEAGUE), here, origin)).toBe(false)
  })
  it('the console row, Members link, and shell/league nav leave — and ask', () => {
    expect(leavesSettings(`/app/leagues/${LEAGUE}/commish`, here, origin)).toBe(true)
    expect(leavesSettings(`/app/leagues/${LEAGUE}/members`, here, origin)).toBe(true)
    expect(leavesSettings(`/app/leagues/${LEAGUE}`, here, origin)).toBe(true)
    expect(leavesSettings('/app', here, origin)).toBe(true)
    expect(leavesSettings('https://elsewhere.example/x', here, origin)).toBe(true)
  })
  it('the confirm dialog is not open while nothing is pending', () => {
    expect(render(detailFor('commissioner'), 'draft')).not.toContain('data-leave-settings-dialog')
  })
})

describe('R1498 — the scoring summary shows a loading state while templates load', () => {
  it('reads "Loading scoring…" instead of a blank or a guess', () => {
    const html = render(detailFor('commissioner'), null, { noTemplates: true })
    const row = html.slice(html.indexOf('data-settings-row="scoring"'))
    expect(row.slice(0, row.indexOf('</a>'))).toContain('Loading scoring…')
  })
})
