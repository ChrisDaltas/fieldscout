/**
 * The settings panel's IN-SEASON editing — M6A L.E1.13 item 3 (tasks-M6A §6;
 * PROGRESS §3 STANDING RULE (h); D347 / D360; Q64; Q66). A REAL static render
 * of `SettingsPanel` per state — free vs gated, loading, error, ready — and
 * of `InSeasonOverrideBlock` per branch of 129's result document. The pure
 * decisions are pinned in `settings-panel-ops.test.ts`.
 *
 * The override-mode READ is a spy over the real hook (zustand v5 answers a
 * static render with `getInitialState()`, so `setState` cannot reach it —
 * `team-page.render.test.ts`'s note); the store's own behaviour is pinned in
 * `stores/commish-override-store.test.ts`.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { commishSettingPolicyKeys, type SettingPolicies } from '@/hooks/use-commish-setting-policy'
import type { LeagueDetail } from '@/hooks/use-league'
import { leaguesKeys } from '@/hooks/use-leagues'
import { defaultsForTeamCount } from '@/lib/leagues/settings/league-settings'
import { useOverrideMode } from '@/stores/commish-override-store'

import { InSeasonOverrideBlock, SettingsPanel } from './settings-panel'
import {
  SETTINGS_OVERRIDE_BAR_OFF_COPY,
  SETTINGS_OVERRIDE_BAR_ON_COPY,
  SETTINGS_POLICY_PROBLEM_COPY,
  settingOutcome,
  settingPolicyKeys,
  type SettingSaveResult,
} from './settings-panel-ops'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }) }))
vi.mock('@/stores/commish-override-store', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/stores/commish-override-store')>()
  return { ...orig, useOverrideMode: vi.fn(orig.useOverrideMode) }
})

const LEAGUE = 'league-1'
const settings = defaultsForTeamCount(10)

const detail: LeagueDetail = {
  league: {
    id: LEAGUE,
    name: 'Render League',
    avatar_url: null,
    season: 2099,
    status: 'in_season',
    owner_id: 'user-commish',
    scoring_system_id: null,
    invite_code: null,
    invite_slug: null,
    max_teams: 10,
    created_at: null,
    updated_at: null,
    champion_team_id: null,
  },
  settings,
  members: [],
  teams: [],
  my_role: 'commissioner',
  active_draft: null,
} as unknown as LeagueDetail

// 129's table AS IT ANSWERS (129:300-352) — the refusal copy is the
// migration's own text, carried here so "verbatim" is an equality.
const TEAM_COUNT_WHY =
  'team_count is PRE-DRAFT ONLY (§7.3, erratum v2.16.40 — Q65 ruled (b) by Chris 2026-09-15): seats (teams / league_members) and a schedule already exist for the stored count'
const BRACKET_WHY = 'once the league is in playoffs (or complete) the bracket has been SEEDED from this key (118:1075-1077, :1338-1340); no verb re-seeds a bracket under played rounds'
const DRAFT_WHY = 'the §7.3.8 draft block: pre-draft it belongs to the wizard / update_league_settings; post-draft the draft has happened and the block has no subject'

const REFUSED: Record<string, string> = {
  team_count: TEAM_COUNT_WHY,
  regular_season_weeks: 'this key defines the SEASON WINDOW',
  playoff_start_week: 'this key defines the SEASON WINDOW',
  schedule_mode: 'this key defines the SCHEDULE SHAPE',
  median_game: 'this key defines the SCHEDULE SHAPE',
  second_opponent: 'this key defines the SCHEDULE SHAPE',
  format: 'pinned to redraft in v1',
  lineup_lock: 'pinned to per_player_kickoff',
  divisions: 'pinned to 1',
  playoff_byes: 'derived from the bracket size',
  schedule_seed: 'minted by the schedule engine',
  draft: DRAFT_WHY,
}
const BRACKET = ['playoff_teams', 'playoff_weeks_per_round', 'consolation_bracket', 'third_place_game']

const POLICIES: SettingPolicies = Object.fromEntries(
  settingPolicyKeys(settings).map((key) => [
    key,
    key in REFUSED
      ? { storage: 'column' as const, class: 'refused' as const, refused_why: REFUSED[key] }
      : BRACKET.includes(key)
        ? { storage: 'blob' as const, class: 'bracket' as const, refused_why: BRACKET_WHY }
        : key === 'scoring_system_id'
          ? { storage: 'column' as const, class: 'rescore' as const, refused_why: null }
          : { storage: 'blob' as const, class: 'free' as const, refused_why: null },
  ]),
)

interface Seed {
  detail?: LeagueDetail
  policies?: SettingPolicies | 'error' | 'missing'
  mode?: boolean
}

function renderPanel(seed: Seed = {}): string {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, retryOnMount: false } } })
  const d = seed.detail ?? detail
  qc.setQueryData(leaguesKeys.detail(LEAGUE), d)
  const key = commishSettingPolicyKeys.table(settingPolicyKeys(d.settings))
  const policies = seed.policies ?? POLICIES
  if (policies === 'error') {
    const query = qc.getQueryCache().build(qc, { queryKey: key })
    query.setState({ status: 'error', error: new Error('commish_setting_policy(team_count): boom'), fetchStatus: 'idle' })
  } else if (policies !== 'missing') qc.setQueryData(key, policies)
  vi.mocked(useOverrideMode).mockReturnValue(seed.mode ?? false)
  try {
    return renderToStaticMarkup(createElement(QueryClientProvider, { client: qc }, createElement(SettingsPanel, { leagueId: LEAGUE })))
      .replace(/&#x27;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&')
  } finally {
    vi.mocked(useOverrideMode).mockReset()
  }
}

/** The opening tag that carries `marker`. */
function openTagOf(html: string, marker: string): string {
  const at = html.indexOf(marker)
  if (at < 0) return ''
  return html.slice(html.lastIndexOf('<', at), html.indexOf('>', at) + 1)
}

const withStatus = (status: string, role: LeagueDetail['my_role'] = 'commissioner'): LeagueDetail =>
  ({ ...detail, my_role: role, league: { ...detail.league, status } }) as LeagueDetail

// ---------------------------------------------------------------------------
// free vs gated
// ---------------------------------------------------------------------------

describe('in-season settings — free vs gated (rule (h): ONE switch, the shared one)', () => {
  it('PRE-DRAFT: the ordinary editable panel — NO override switch at all (nothing is being overridden)', () => {
    const html = renderPanel({ detail: withStatus('setup'), mode: true })
    expect(html).not.toContain('data-settings-override')
    expect(html).not.toContain('data-override-toggle')
    expect(html).toContain('data-settings-fieldset="open"')
  })

  it('IN-SEASON, a MANAGER: read-only, no switch — and the mode never reaches him even when the store says the league is in it', () => {
    const html = renderPanel({ detail: withStatus('in_season', 'manager'), mode: true })
    expect(html).not.toContain('data-override-toggle')
    expect(html).toContain('data-settings-fieldset="closed"')
    expect(html).toContain('only the commissioner can change them')
  })

  it('IN-SEASON, commissioner, mode OFF: the SHARED switch (OverrideModeBar — same markup as the team and matchup pages) with the settings sentence, the form closed, and the old "arrives with the in-season tools" placeholder GONE', () => {
    const html = renderPanel({ mode: false })
    expect(html).toContain('data-settings-override="off"')
    expect(html).toContain('data-commish-tools') // OverrideModeBar's own marker
    expect(html).toContain('data-override-toggle="off"')
    expect(html).toContain('aria-pressed="false"')
    expect(html).toContain(SETTINGS_OVERRIDE_BAR_OFF_COPY)
    expect(html).toContain('data-settings-fieldset="closed"')
    expect(html).not.toContain('arrives with the in-season tools')
    const source = readFileSync(path.resolve(process.cwd(), 'src/components/leagues/settings-panel.tsx'), 'utf8')
    expect(source).toContain("from './override-mode-bar'")
    // ONE switch on the page.
    expect(html.match(/data-override-toggle=/g)).toHaveLength(1)
  })

  it('mode ON: the visible on-state (badge, aria-pressed, the lime frame), the form OPEN, and NO reason input anywhere (Q66)', () => {
    const html = renderPanel({ mode: true })
    expect(html).toContain('data-settings-override="on"')
    expect(html).toContain('✸ Override mode ON')
    expect(html).toContain('aria-pressed="true"')
    expect(html).toContain(SETTINGS_OVERRIDE_BAR_ON_COPY)
    expect(html).toContain('data-settings-fieldset="open"')
    expect(html).not.toMatch(/placeholder="[^"]*reason/i)
    expect(html).not.toMatch(/>\s*Reason/)
    // Nothing changed yet ⇒ Save is closed, and the bar says why.
    expect(html).toContain('Nothing to save yet — change a setting below.')
  })
})

// ---------------------------------------------------------------------------
// the policy table's own states
// ---------------------------------------------------------------------------

describe('129’s policy table is READ — loading and a FAILED read keep the form closed, by name', () => {
  it('LOADING: a named status + skeleton; the form stays closed until the table has been read', () => {
    const html = renderPanel({ mode: true, policies: 'missing' })
    expect(html).toContain('data-skeleton="setting-policies"')
    expect(html).toContain('data-settings-fieldset="closed"')
  })

  it('ERROR: said as a FAILED READ with Retry — never "locked", never an open form with every key treated as changeable', () => {
    const html = renderPanel({ mode: true, policies: 'error' })
    expect(html).toContain('data-problem="setting-policies"')
    expect(html).toContain(SETTINGS_POLICY_PROBLEM_COPY)
    expect(html).toContain('role="alert"')
    expect(html).toContain('data-settings-fieldset="closed"')
  })

  it('mode OFF reads nothing: no skeleton, no problem', () => {
    const html = renderPanel({ mode: false, policies: 'error' })
    expect(html).not.toContain('data-problem="setting-policies"')
    expect(html).not.toContain('data-skeleton="setting-policies"')
  })
})

// ---------------------------------------------------------------------------
// refused-in-season keys: closed, with 129's copy VERBATIM
// ---------------------------------------------------------------------------

describe('a key 129 marks refused-in-season is CLOSED and shows 129’s refusal copy VERBATIM (item 3)', () => {
  it('team_count: the select is disabled and its hint IS the policy row’s refused_why, character for character', () => {
    const html = renderPanel({ mode: true })
    expect(openTagOf(html, 'id="set-teams"')).toContain('disabled=""')
    expect(html).toContain(TEAM_COUNT_WHY)
  })

  it('the whole `draft` block closes as one, under 129’s own sentence', () => {
    const html = renderPanel({ mode: true })
    expect(html).toContain('data-refused-key="draft"')
    expect(html).toContain(DRAFT_WHY)
    expect(html).toContain('data-draft-fieldset="closed"')
  })

  it('a FREE key and the BRACKET class before the playoffs stay OPEN — and carry their ordinary hints, not a refusal', () => {
    const html = renderPanel({ mode: true })
    expect(openTagOf(html, 'id="set-playoff-teams"')).not.toContain('disabled=""')
    expect(openTagOf(html, 'id="set-reseed"')).not.toContain('disabled=""')
    expect(html).not.toContain(BRACKET_WHY)
    expect(html).toContain('0 = points-only champion.')
  })

  it('the BRACKET class CLOSES once the league is in `playoffs` — by status, with 129’s copy (D360(5))', () => {
    const html = renderPanel({ mode: true, detail: withStatus('playoffs') })
    expect(openTagOf(html, 'id="set-playoff-teams"')).toContain('disabled=""')
    expect(openTagOf(html, 'id="set-consolation"')).toContain('disabled=""')
    expect(html).toContain(BRACKET_WHY)
    // …while playoff_reseed is FREE in 129's table and stays open.
    expect(openTagOf(html, 'id="set-reseed"')).not.toContain('disabled=""')
  })

  it('mode OFF: no refusal copy is rendered — the form is simply closed', () => {
    expect(renderPanel({ mode: false })).not.toContain(TEAM_COUNT_WHY)
  })
})

// ---------------------------------------------------------------------------
// the per-key results — every branch of 129's document
// ---------------------------------------------------------------------------

function renderBlock(results: SettingSaveResult[], over: Partial<Parameters<typeof InSeasonOverrideBlock>[0]> = {}): string {
  return renderToStaticMarkup(
    createElement(InSeasonOverrideBlock, { on: true, saving: false, policyState: 'ready', onRetryPolicies: () => {}, onToggle: () => {}, results, ...over }),
  )
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
}

type Doc = Parameters<typeof settingOutcome>[0]
const doc: Doc = { key: 'waiver_period_hours', no_changes: false, no_changes_why: null, rescore_not_performed_why: null, consequences: {} }
const ok = (over: Partial<Doc>, bypassed: string[] = []): SettingSaveResult => {
  const merged = { ...doc, ...over }
  return { key: merged.key, ok: true, outcome: settingOutcome(merged), bypassed }
}

describe('InSeasonOverrideBlock — one line per key, never a bare "Saved."', () => {
  it('THE `rescore_not_performed_why` ARM IS RENDERED, never swallowed: caution, in 129’s own words', () => {
    const why = 'not_requested — rescore was not asked for: 1 final week(s) [1] keep their stored scores'
    const html = renderBlock([ok({ key: 'scoring_system_id', rescore_not_performed_why: why })])
    expect(html).toContain('data-setting-outcome="rescore_not_performed"')
    expect(html).toContain(why)
    expect(html).toContain('scores were NOT re-scored')
    expect(html).not.toContain('data-setting-outcome="saved"')
  })

  it('a no-op says nothing changed — never "saved" — and carries no bypass narration', () => {
    const html = renderBlock([ok({ no_changes: true, no_changes_why: 'value_already_set' }, ['league_status_gate'])])
    expect(html).toContain('data-setting-outcome="no_changes"')
    expect(html).toContain('value_already_set')
    expect(html).not.toMatch(/: saved/)
    expect(html).not.toContain('data-setting-bypassed')
  })

  it('a clean save names the key, says it was recorded and posted, and renders bypassed[] back', () => {
    const html = renderBlock([ok({}, ['update_league_settings_status_gate'])])
    expect(html).toContain('data-setting-outcome="saved"')
    expect(html).toContain('waiver period hours: saved — recorded and posted to the league.')
    expect(html).toContain('This change walked past: update_league_settings_status_gate.')
  })

  it('a REFUSAL is the verb’s sentence VERBATIM (role="alert"), beside the keys that DID land — one line each', () => {
    const refusal = 'commish_change_setting: rescore was requested but week 1 is FINAL — no verb reopens a final week yet'
    const html = renderBlock([ok({}), { key: 'scoring_system_id', ok: false, refusal }])
    expect(html.match(/data-setting-result=/g)).toHaveLength(2)
    expect(html).toContain(refusal)
    expect(html).toContain('data-setting-outcome="refused"')
    expect(html).toContain('role="alert"')
  })

  it('SAVING: said, and the switch is locked (R985 — leaving mid-save would orphan the outcome lines)', () => {
    const html = renderBlock([], { saving: true })
    expect(html).toContain('data-settings-saving')
    expect(html).toContain('data-override-toggle-blocked="saving"')
  })

  it('settings-panel.tsx gains NO resting shadow beyond its one pinned save bar, and no dark: variant', () => {
    const source = readFileSync(path.resolve(process.cwd(), 'src/components/leagues/settings-panel.tsx'), 'utf8')
    const block = source.slice(source.indexOf('export function InSeasonOverrideBlock'), source.indexOf('function PanelShell'))
    expect(block).not.toMatch(/shadow-/)
    expect(block).not.toMatch(/\bdark:/)
  })
})
