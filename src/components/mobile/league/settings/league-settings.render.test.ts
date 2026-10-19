/**
 * League Menu › League settings / Scoring / Playoffs on the phone (handoff
 * m-community G2; gap list §4 item 105) — the screens rendered from seeded
 * queries (`renderToStaticMarkup`; effects don't run), on the same reads as
 * desktop's settings page: the league detail, the scoring templates and the
 * league's scoring document. The pure rows are pinned in
 * `league-settings-ops.test.ts`.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { SETTINGS_OVERRIDE_BAR_OFF_COPY, SETTINGS_OVERRIDE_BAR_ON_COPY, settingPolicyKeys, type SettingPolicies } from '@/components/leagues/settings-panel-ops'
import { commishSettingPolicyKeys } from '@/hooks/use-commish-setting-policy'
import { auctionPoolKeys } from '@/hooks/use-draft-pool'
import type { LeagueDetail } from '@/hooks/use-league'
import { leaguesKeys } from '@/hooks/use-leagues'
import { scoringTemplatesKeys } from '@/hooks/use-scoring-templates'
import { SCORING_TEMPLATES } from '@/lib/leagues/scoring/templates'
import { defaultsForTeamCount } from '@/lib/leagues/settings/league-settings'
import type { SettingsSection } from '@/components/leagues/settings-index-ops'
import { useOverrideMode } from '@/stores/commish-override-store'

import { checklistHref } from '@/components/mobile/league/league/preseason'

import { leagueNameGate } from './league-profile-sheet'
import { saveSummary, SettingsEditScreen } from './league-settings-edit'
import type { SettingsPage } from './league-settings-ops'
import { MEMBER_FOOTER, MobileLeagueSettings } from './league-settings-screen'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/app/leagues/league-1/settings',
  useSearchParams: () => new URLSearchParams(''),
}))
vi.mock('@/stores/commish-override-store', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/stores/commish-override-store')>()
  return { ...orig, useOverrideMode: vi.fn(orig.useOverrideMode) }
})

const LEAGUE = 'league-1'
const ESPN = SCORING_TEMPLATES.find((t) => t.name === 'ESPN Standard')!
const TEMPLATES = SCORING_TEMPLATES.map((t, i) => ({ id: `tpl-${i}`, name: t.name, description: t.description, rules: t.rules as Record<string, number> }))
const ESPN_ID = TEMPLATES.find((t) => t.name === 'ESPN Standard')!.id

const detail = (status: string, role: string | null): LeagueDetail =>
  ({
    league: {
      id: LEAGUE,
      name: 'Sunday Funday League',
      avatar_url: null,
      description: null,
      season: 2099,
      status,
      owner_id: 'user-marcus',
      scoring_system_id: ESPN_ID,
      invite_code: null,
      invite_slug: null,
      max_teams: 8,
      created_at: null,
      updated_at: null,
      champion_team_id: null,
    },
    settings: defaultsForTeamCount(8),
    members: [
      { id: 'm1', user_id: 'user-marcus', team_id: 't1', role: 'commissioner', is_placeholder: false, is_autodraft: false, joined_at: null, profiles: { username: 'marcus', avatar_url: null } },
      { id: 'm2', user_id: 'user-kelly', team_id: 't2', role: 'manager', is_placeholder: false, is_autodraft: false, joined_at: null, profiles: { username: 'kelly', avatar_url: null } },
    ],
    teams: [
      { id: 't1', name: 'Fourth & Long', owner_id: 'user-marcus', status: 'active', created_at: null },
      { id: 't2', name: 'Waiver Wire Wizards', owner_id: 'user-kelly', status: 'active', created_at: null },
    ],
    my_role: role,
    active_draft: null,
  }) as LeagueDetail

const POLICIES: SettingPolicies = Object.fromEntries(
  settingPolicyKeys(defaultsForTeamCount(8)).map((key) => [
    key,
    key === 'team_count'
      ? { storage: 'column' as const, class: 'refused' as const, refused_why: 'The number of teams can only change before the draft.' }
      : { storage: 'blob' as const, class: 'free' as const, refused_why: null },
  ]),
)

interface Seed {
  status?: string
  role?: string | null
  section?: SettingsSection | null
  override?: boolean
  scoring?: unknown
  startEditing?: boolean
}

function client(seed: Seed): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, retryOnMount: false } } })
  const d = detail(seed.status ?? 'in_season', seed.role === undefined ? 'manager' : seed.role)
  qc.setQueryData(leaguesKeys.detail(LEAGUE), d)
  qc.setQueryData(scoringTemplatesKeys.all, TEMPLATES)
  qc.setQueryData(auctionPoolKeys.scoring(LEAGUE), seed.scoring === undefined ? ESPN.rules : seed.scoring)
  qc.setQueryData(commishSettingPolicyKeys.table(settingPolicyKeys(d.settings)), POLICIES)
  return qc
}

const unescape = (html: string) => html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&')

function renderScreen(seed: Seed = {}): string {
  vi.mocked(useOverrideMode).mockReturnValue(seed.override ?? false)
  try {
    return unescape(
      renderToStaticMarkup(
        createElement(
          QueryClientProvider,
          { client: client(seed) },
          createElement(MobileLeagueSettings, { leagueId: LEAGUE, section: seed.section ?? null, startEditing: seed.startEditing }),
        ),
      ),
    )
  } finally {
    vi.mocked(useOverrideMode).mockReset()
  }
}

function renderEdit(page: SettingsPage, seed: Seed = {}): string {
  const qc = client({ status: 'setup', role: 'commissioner', ...seed })
  const d = qc.getQueryData<LeagueDetail>(leaguesKeys.detail(LEAGUE))!
  return unescape(
    renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client: qc },
        createElement(SettingsEditScreen, { leagueId: LEAGUE, detail: d, page, canEdit: true, inSeason: null, saving: false, onClose: () => {} }),
      ),
    ),
  )
}

/** The value beside a row's label (`data-settings-row`). */
function rowValue(html: string, key: string): string | null {
  const at = html.indexOf(`data-settings-row="${key}"`)
  if (at < 0) return null
  const row = html.slice(at, html.indexOf('</div>', at) + 6)
  const texts = [...row.matchAll(/>([^<>]+)</g)].map((m) => m[1].trim()).filter(Boolean)
  return texts[texts.length - 1] ?? null
}

describe('League settings for a member (handoff G2)', () => {
  it('the page bar, the handoff’s rows from the league’s real settings, and the footer — no Edit, no override switch', () => {
    const html = renderScreen()
    expect(html).toMatch(/<h1[^>]*>League settings<\/h1>/)
    expect(html).toContain('data-league-settings="general"')
    for (const title of ['League', 'Roster', 'Draft', 'Waivers & trades']) expect(html).toContain(`>${title}</h2>`)
    // Two of the eight seats have a manager.
    expect(rowValue(html, 'teams')).toBe('8 · 6 open spots')
    expect(rowValue(html, 'starters')).toBe('QB, 2 RB, 3 WR, TE, FLEX, K, D/ST')
    expect(rowValue(html, 'type')).toBe('Snake')
    expect(html).toContain('data-username-link="marcus"')
    expect(html).toContain(MEMBER_FOOTER)
    expect(html).not.toContain('data-settings-edit')
    expect(html).not.toContain('data-override-toggle')
    // A member's League name row is a plain row, not the commissioner's door.
    expect(html).not.toMatch(/<button[^>]*data-settings-row="name"/)
  })

  it('Playoffs (`?section=league`): Format and Other, the tiebreak order, and the bracket note', () => {
    const html = renderScreen({ section: 'league' })
    expect(html).toMatch(/<h1[^>]*>Playoffs<\/h1>/)
    for (const title of ['Format', 'Other', 'Tiebreakers']) expect(html).toContain(`>${title}</h2>`)
    expect(rowValue(html, 'weeks')).toBe('15, 16, 17')
    expect(rowValue(html, 'byes')).toBe('Top 2 seeds')
    expect(html).toContain('The playoff bracket shows at the top of the League tab once the playoffs start in Week 15.')
    expect(html).toContain(MEMBER_FOOTER)
  })

  it('Scoring (`?section=scoring`): the rulebook’s name, then every value the league pays', () => {
    const html = renderScreen({ section: 'scoring' })
    expect(html).toMatch(/<h1[^>]*>Scoring<\/h1>/)
    expect(rowValue(html, 'rulebook')).toBe('ESPN Standard')
    expect(rowValue(html, 'pass_yards')).toBe('1 pt per 25')
    expect(rowValue(html, 'interceptions')).toBe('−2')
    expect(html).toContain('>Points allowed</h2>')
  })

  it('Scoring says so when the league has no scoring yet, or it can’t be read — never an empty page', () => {
    expect(renderScreen({ section: 'scoring', scoring: null })).toContain('This league has no scoring set yet.')
    expect(renderScreen({ section: 'scoring', scoring: { format: 3, base: {} } })).toContain('This league’s scoring can’t be read.')
  })
})

describe('League settings for the commissioner', () => {
  it('before the draft: Edit in the bar, the League name row opens the name-and-photo sheet, Commissioner tools, no footer', () => {
    const html = renderScreen({ status: 'setup', role: 'commissioner' })
    expect(html).toMatch(/<button[^>]*data-settings-edit[^>]*>Edit<\/button>/)
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*data-settings-edit/)
    expect(html).toMatch(/<button[^>]*data-settings-row="name"/)
    expect(html).toContain('data-door="commish"')
    expect(html).not.toContain(MEMBER_FOOTER)
    expect(html).not.toContain('data-settings-override')
  })

  it('a co-commissioner runs the league the same way', () => {
    expect(renderScreen({ status: 'scheduled', role: 'co_commissioner' })).toContain('data-settings-edit')
  })

  it('in season, override off: settings are locked — the override switch with its sentence, and no Edit', () => {
    const html = renderScreen({ status: 'in_season', role: 'commissioner', override: false })
    expect(html).toContain('data-settings-override="off"')
    expect(html).toContain(SETTINGS_OVERRIDE_BAR_OFF_COPY)
    expect(html).toContain('>Turn on override mode</button>')
    expect(html).not.toContain('data-settings-edit')
  })

  it('in season, override on: the green strip and Edit — no reason asked anywhere', () => {
    const html = renderScreen({ status: 'in_season', role: 'commissioner', override: true })
    expect(html).toContain('data-override-indicator')
    expect(html).toMatch(/<button[^>]*data-settings-edit[^>]*>Edit<\/button>/)
    expect(html).not.toContain('data-settings-override="off"')
    expect(html).not.toMatch(/reason/i)
  })
})

describe('the setup checklist opens the editor at its setting', () => {
  it('links the draft-time and scoring rows with `&edit=1`', () => {
    expect(checklistHref('schedule', LEAGUE)).toBe(`/app/leagues/${LEAGUE}/settings?section=draft&edit=1`)
    expect(checklistHref('scoring', LEAGUE)).toBe(`/app/leagues/${LEAGUE}/settings?section=scoring&edit=1`)
    expect(checklistHref('settings', LEAGUE)).toBe(`/app/leagues/${LEAGUE}/settings`)
  })

  it('a commissioner who can edit lands in the editor; anyone else lands on the rows', () => {
    expect(renderScreen({ status: 'setup', role: 'commissioner', startEditing: true })).toContain('data-settings-editing="general"')
    expect(renderScreen({ status: 'setup', role: 'manager', startEditing: true })).not.toContain('data-settings-editing')
    // Past the draft, without override mode, nothing can change: the rows.
    expect(renderScreen({ status: 'in_season', role: 'commissioner', startEditing: true })).not.toContain('data-settings-editing')
  })
})

describe('Edit: the shared settings groups in the phone skin', () => {
  it('League settings: Cancel and a closed Save until something changes, then the page’s groups', () => {
    const html = renderEdit('general')
    expect(html).toMatch(/<button[^>]*data-settings-cancel[^>]*>Cancel<\/button>/)
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*data-settings-save[^>]*>Save<\/button>/)
    expect(html).toContain('Change a setting, then Save.')
    for (const g of ['League', 'Roster & lineup slots', 'Lineups & lock', 'Schedule the draft', 'Draft configuration', 'Waivers & free agency', 'Trades'])
      expect(html).toContain(`data-settings-group="${g}"`)
    // The phone skin: no desktop group card.
    expect(html).not.toMatch(/class="settings-rows/)
    expect(html).toContain('id="set-teams"')
    expect(html).toContain('id="set-trade-deadline"')
    expect(html).not.toContain('id="set-playoff-teams"')
  })

  it('Playoffs: the bracket rows and the tiebreak order', () => {
    const html = renderEdit('playoffs')
    expect(html).toContain('data-settings-group="Playoffs"')
    expect(html).toContain('data-settings-group="Tiebreakers"')
    expect(html).toContain('id="set-playoff-teams"')
    expect(html).toContain('id="set-reseed"')
    expect(html).not.toContain('id="set-teams"')
  })

  it('Scoring: the template picker, and the custom values editor while they can still change', () => {
    const html = renderEdit('scoring')
    expect(html).toContain('data-settings-group="Scoring"')
    expect(html).toContain('data-template-card')
    expect(html).toContain('id="league-custom-scoring-editor"')
    // Past the draft the values are frozen — the rows on the page show them.
    expect(renderEdit('scoring', { status: 'in_season' })).not.toContain('id="league-custom-scoring-editor"')
  })
})

describe('the words around Save', () => {
  const base = { plan: null, dirty: false, validation: { valid: true, errors: [], warnings: [] } }
  it('says what Save will do, or why it can’t yet', () => {
    expect(saveSummary(base, false)).toBe('Change a setting, then Save.')
    expect(saveSummary({ ...base, dirty: true }, false)).toBe('Unsaved changes — Save keeps them.')
    expect(saveSummary({ ...base, dirty: true, validation: { valid: false, errors: [{ field: 'team_count', message: 'x' }], warnings: [] } }, false)).toBe('1 to fix before you can save.')
    expect(saveSummary({ ...base, plan: { send: [], refused: [] } }, true)).toBe(SETTINGS_OVERRIDE_BAR_ON_COPY)
    expect(saveSummary({ ...base, plan: { send: [{ key: 'trade_deadline_week', value: 12 }], refused: [] } }, true)).toBe(
      '1 setting to save — each is recorded and posted to the league.',
    )
  })

  it('the league name saves only when it changed and fits', () => {
    expect(leagueNameGate('Sunday Funday League', 'Sunday Funday League')).toEqual({ ok: false, why: null })
    expect(leagueNameGate('  ', 'Sunday Funday League')).toEqual({ ok: false, why: 'Give the league a name.' })
    expect(leagueNameGate('x'.repeat(101), 'Sunday Funday League')).toEqual({ ok: false, why: 'Keep it to 100 characters.' })
    expect(leagueNameGate('  Monday Madness ', 'Sunday Funday League')).toEqual({ ok: true, name: 'Monday Madness' })
  })
})
