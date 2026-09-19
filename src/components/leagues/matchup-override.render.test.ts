/**
 * matchup-override.render.test.ts — M6A task L.E1.12: the commissioner's
 * override MODE on the matchup page, the panel per branch of 126's result
 * document, the a11y of the switch, and the `✸ Adjusted` marker present
 * exactly when `matchups.is_overridden` is (spec §15.4:1692-1693, §10.3;
 * PROGRESS §3 STANDING RULE (h), D342, Q61, Q66, F343; tasks-M6A §4 rules
 * 14/15, R971).
 *
 * The `matchup-view.render.test.ts` rig, cut to what these cells read:
 * `renderToStaticMarkup` over the REAL page with the React Query cache
 * pre-seeded. The override-mode READ is a spy over the real hook (the
 * `team-page.render.test.ts` rig, for its reason: zustand v5 answers the
 * server snapshot with `getInitialState()`, so `setState` cannot reach a
 * static render) — un-mocked it IS the real hook, i.e. mode OFF.
 *
 * Probes of the PR (each shown RED against a ONE-SITE break, then restored
 * with `diff -q`):
 *   P5 — mount the tools only while the week is not `final` (the "behind a
 *        week state" shape rule (h) forbids) → the every-week-state cell;
 *   P6 — drop the `isCommish` gate on the mount → the manager cell;
 *   P7 — add a reason <textarea> to the panel → the no-reason-field cell;
 *   P2 — paint `no_changes` with a "Saved" sentence → the no_changes cells
 *        (here and in `matchup-override-ops.test.ts`, which also owns P3/P4);
 *   P9 — drop `aria-pressed` from the switch → the a11y cell;
 *   P12 — render the `✸ Adjusted` chip unconditionally → the exactly-when cell.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import type { LeagueDetail } from '@/hooks/use-league'
import { leaguesKeys } from '@/hooks/use-leagues'
import { leagueMatchupKeys } from '@/hooks/use-matchups'
import { scheduleKeys, type LeagueSchedule } from '@/hooks/use-schedule'
import type { WeekMatchups } from '@/lib/leagues/api/matchups-service'
import { defaultsForTeamCount } from '@/lib/leagues/settings/league-settings'
import { useOverrideMode } from '@/stores/commish-override-store'

import {
  BYE_ROW_COPY,
  LIVE_SCORING_STOPPED_COPY,
  NO_CHANGES_COPY,
  OVERRIDE_BAR_OFF_COPY,
  OVERRIDE_BAR_ON_COPY,
  STANDINGS_AT_FINALIZATION_COPY,
  STANDINGS_REBUILT_COPY,
  WILL_BE_OVERWRITTEN_COPY,
} from './matchup-override-ops'
import { MatchupOverridePanelView } from './matchup-override-panel'
import { MatchupPage } from './matchup-view'

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ user: { id: 'user-commish' }, profile: { username: 'chris' } }),
}))
vi.mock('@/hooks/use-league-channel', () => ({
  useLeagueChannel: vi.fn(() => ({ connection: 'live' })),
}))
vi.mock('@/stores/commish-override-store', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/stores/commish-override-store')>()
  return { ...orig, useOverrideMode: vi.fn(orig.useOverrideMode) }
})

// ---------------------------------------------------------------------------
// Rig
// ---------------------------------------------------------------------------

const LEAGUE = 'league-1'
const T1 = 'aaaaaaaa-0000-4000-8000-000000000001'
const T2 = 'aaaaaaaa-0000-4000-8000-000000000002'
const T3 = 'aaaaaaaa-0000-4000-8000-000000000003'
const T4 = 'aaaaaaaa-0000-4000-8000-000000000004'
const NAMES = new Map([
  [T1, 'Alpha'],
  [T2, 'Bravo'],
  [T3, 'Charlie'],
  [T4, 'Delta'],
])

function detailAs(role: 'commissioner' | 'co_commissioner' | 'manager'): LeagueDetail {
  return {
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
      { id: 'm1', user_id: 'user-commish', team_id: T1, role, is_placeholder: false, is_autodraft: false, joined_at: null, profiles: null },
    ],
    teams: [...NAMES.entries()].map(([id, name]) => ({ id, name, owner_id: 'user-commish', status: 'active', created_at: null })),
    my_role: role,
    active_draft: null,
  }
}

const SCHEDULE: LeagueSchedule = {
  weeks: [{ id: 'w1', season: 2099, week: 1, status: 'live', finalized_at: null, median_score: null }],
  matchups: [],
}

const M1 = { id: 'm1', season: 2099, week: 1, round_type: 'regular', status: 'live', home_team_id: T1, away_team_id: T2, home_score: 71.5, away_score: 35, result: null, is_overridden: false, updated_at: null }
const M2 = { id: 'm2', season: 2099, week: 1, round_type: 'regular', status: 'live', home_team_id: T3, away_team_id: T4, home_score: null, away_score: 12.25, result: null, is_overridden: false, updated_at: null }

function weekDoc(over: Partial<WeekMatchups> = {}): WeekMatchups {
  return {
    league_id: LEAGUE,
    season: 2099,
    week: 1,
    schedule_mode: 'h2h',
    league_week: { status: 'live', median_score: null, finalized_at: null },
    teams: [...NAMES.entries()].map(([id, name]) => ({ id, name, status: 'active' })),
    matchups: [M1, M2],
    results: [],
    ...over,
  }
}

function unescapeHtml(html: string): string {
  return html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&')
}

function between(html: string, from: string, to: string): string {
  const start = html.indexOf(from)
  const end = html.indexOf(to, start + 1)
  return html.slice(start, end === -1 ? undefined : end)
}

function renderPage(seed: { detail?: LeagueDetail; week?: WeekMatchups; matchupId?: string | null; overrideMode?: boolean } = {}): string {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, retryOnMount: false } } })
  qc.setQueryData(leaguesKeys.detail(LEAGUE), seed.detail ?? detailAs('commissioner'))
  qc.setQueryData(scheduleKeys.all(LEAGUE), SCHEDULE)
  qc.setQueryData(leagueMatchupKeys.week(LEAGUE, 1), seed.week ?? weekDoc())
  const spy = vi.mocked(useOverrideMode)
  if (seed.overrideMode !== undefined) spy.mockReturnValue(seed.overrideMode)
  try {
    return unescapeHtml(
      renderToStaticMarkup(
        createElement(QueryClientProvider, { client: qc }, createElement(MatchupPage, { leagueId: LEAGUE, matchupId: seed.matchupId ?? null, weekParam: 1 })),
      ),
    )
  } finally {
    spy.mockReset()
  }
}

// ---------------------------------------------------------------------------
// The mode
// ---------------------------------------------------------------------------

describe('override MODE on the matchup page — one switch, every week state, commissioner only (rule (h))', () => {
  it('PREMISE: the page renders the viewer’s matchup, and un-mocked the mode is OFF', () => {
    const html = renderPage()
    expect(html).toContain('data-matchup="m1"')
    expect(html).toContain('data-matchup-override="m1"')
    expect(html).toContain('data-override-mode="off"')
  })

  it('the switch is there in EVERY week state — upcoming, live, correction window, final — never behind a refusal or a status', () => {
    for (const status of ['upcoming', 'live', 'correction_window', 'final']) {
      const html = renderPage({
        week: weekDoc({
          league_week: { status, median_score: null, finalized_at: null },
          matchups: [{ ...M1, status: status === 'final' ? 'final' : 'live' }],
        }),
      })
      expect(html, status).toContain(`data-week-badge="${status === 'correction_window' ? 'pending_corrections' : status}"`) // premise: the state is the one named
      expect(html, status).toContain('data-override-toggle="off"')
      expect(html, status).toContain('Turn on override mode')
      expect(html, status).toContain(OVERRIDE_BAR_OFF_COPY)
      // OFF: no panel, no fields, nothing to submit.
      expect(html, status).not.toContain('data-override-panel')
      expect(html, status).not.toContain('<input')
    }
  })

  it('a co-commissioner gets it too; a MANAGER sees none of it — not even with the store saying ON', () => {
    expect(renderPage({ detail: detailAs('co_commissioner') })).toContain('data-override-toggle="off"')
    for (const overrideMode of [false, true]) {
      const html = renderPage({ detail: detailAs('manager'), overrideMode })
      expect(html).toContain('data-matchup="m1"') // premise: the page rendered
      expect(html).not.toContain('data-matchup-override')
      expect(html).not.toContain('data-override-toggle')
      expect(html).not.toContain('data-override-panel')
    }
  })

  it('a total_points week has no matchup row to correct — nothing mounts', () => {
    const html = renderPage({ week: weekDoc({ schedule_mode: 'total_points', matchups: [] }) })
    expect(html).toContain('data-variant="total_points"')
    expect(html).not.toContain('data-matchup-override')
  })

  it('ON: the visible on-state (badge + frame + copy), the switch reads Exit, and the panel opens with BOTH scores and the winner arm', () => {
    const html = renderPage({ overrideMode: true })
    expect(html).toContain('data-override-mode="on"')
    expect(html).toContain('✸ Override mode ON')
    expect(html).toContain(OVERRIDE_BAR_ON_COPY)
    expect(html).toContain('data-override-toggle="on"')
    expect(html).toContain('Exit override mode')
    expect(html).toContain('border-brand-strong bg-brand-soft')
    expect(html).toContain('data-override-panel')
    // D342: both scores, together, seeded from the STORED numbers.
    const form = between(html, 'data-override-arm="score"', '</form>')
    expect(form).toContain('value="71.5"')
    expect(form).toContain('value="35"')
    expect(html).toContain('Declare Alpha the winner')
    expect(html).toContain('Declare Bravo the winner')
    // OFF carries none of the on-state.
    const off = renderPage()
    expect(off).not.toContain('✸ Override mode ON')
    expect(off).not.toContain('border-brand-strong')
  })

  it('A11Y: the switch is a button exposing its state (aria-pressed) inside a status region; each score field has a label bound to it', () => {
    const off = renderPage()
    const on = renderPage({ overrideMode: true })
    expect(between(off, 'data-commish-tools', '</button>')).toContain('aria-pressed="false"')
    expect(between(on, 'data-commish-tools', '</button>')).toContain('aria-pressed="true"')
    expect(off).toMatch(/role="status"[^>]*data-commish-tools/)
    const labels = [...on.matchAll(/<label for="([^"]+)"[^>]*>([^<]+)<\/label>/g)].map((m) => ({ id: m[1], text: m[2] }))
    expect(labels.map((l) => l.text)).toStrictEqual(['Alpha score', 'Bravo score'])
    for (const label of labels) expect(on).toContain(`id="${label.id}"`)
    expect(on).toContain('aria-label="Correct this matchup"')
  })

  it('THERE IS NO REASON FIELD (F343 / Q66): exactly two inputs — the scores — no textarea, and the word "reason" appears nowhere in the block', () => {
    const on = renderPage({ overrideMode: true })
    const block = between(on, 'data-matchup-override', 'data-box=')
    expect(block).toContain('data-override-panel') // premise: the panel is inside the slice
    expect([...block.matchAll(/<input/g)]).toHaveLength(2)
    expect(block).not.toContain('<textarea')
    expect(block).not.toMatch(/reason/i)
  })

  it('a pending (NULL) stored score seeds an EMPTY field and Save says WHY it is disabled — never a dead button', () => {
    const on = renderPage({ overrideMode: true, matchupId: 'm2' })
    const form = between(on, 'data-override-arm="score"', '</form>')
    expect(form).toContain('Charlie score') // premise: m2 is the selected row
    expect(between(form, 'data-score-input="home"', '>')).not.toContain('value="0"')
    expect(form).toMatch(/<button[^>]*\sdisabled=""[^>]*data-save-scores/)
    expect(form).toContain('data-save-gate')
    expect(form).toContain('Enter Charlie’s score as a number')
    // …and with both numbers present the gate line is gone and Save is live.
    const ready = between(renderPage({ overrideMode: true }), 'data-override-arm="score"', '</form>')
    expect(ready).not.toContain('data-save-gate')
    expect(ready).toContain('data-save-scores') // premise: the button is in the slice
    expect(ready).not.toMatch(/<button[^>]*\sdisabled=""[^>]*data-save-scores/)
  })

  it('a BYE row: the mode still switches, and the block says by name why neither arm is offered (F366)', () => {
    const on = renderPage({ overrideMode: true, week: weekDoc({ matchups: [{ ...M1, away_team_id: null, away_score: null }] }) })
    expect(on).toContain('data-override-toggle="on"')
    expect(on).toContain('data-override-bye')
    expect(on).toContain(BYE_ROW_COPY)
    expect(on).not.toContain('data-override-panel')
  })
})

describe('the ✸ Adjusted marker is present EXACTLY when `is_overridden` is (the flag’s first reader)', () => {
  it('flag false ⇒ absent everywhere; true on the selected row ⇒ its chip only; true on another row ⇒ that row’s ✸ only', () => {
    const clean = renderPage()
    expect(clean).not.toContain('data-overridden')
    expect(clean).not.toContain('✸')

    const selected = renderPage({ week: weekDoc({ matchups: [{ ...M1, is_overridden: true }, M2] }) })
    expect([...selected.matchAll(/data-overridden/g)]).toHaveLength(1)
    expect(between(selected, 'data-matchup="m1"', 'data-side=')).toContain('✸ Adjusted')
    expect(between(selected, 'data-matchup-row="m2"', '</a>')).not.toContain('✸')

    const other = renderPage({ week: weekDoc({ matchups: [M1, { ...M2, is_overridden: true }] }) })
    expect(other).not.toContain('✸ Adjusted')
    expect(between(other, 'data-matchup-row="m2"', '</a>')).toContain('✸')
  })
})

// ---------------------------------------------------------------------------
// The panel — one render per branch of the result document
// ---------------------------------------------------------------------------

describe('MatchupOverridePanelView — one render per branch of 126’s result document (R971 / §4 rule 15)', () => {
  const base: Parameters<typeof MatchupOverridePanelView>[0] = {
    homeName: 'Alpha',
    awayName: 'Bravo',
    homeDraft: '71.5',
    awayDraft: '35',
    onHomeDraft: () => {},
    onAwayDraft: () => {},
    pending: null,
    outcome: null,
    refusal: null,
    onSaveScores: () => {},
    onDeclareWinner: () => {},
  }
  const panel = (over: Partial<typeof base> = {}) => unescapeHtml(renderToStaticMarkup(createElement(MatchupOverridePanelView, { ...base, ...over })))
  const result = (over: Partial<NonNullable<(typeof base)['outcome']>> = {}) => ({
    no_changes: false,
    live_scoring_frozen: false,
    live_scoring_frozen_why: 'week_final — live scoring for this week is over',
    standings_rebuilt: false,
    bypassed: [] as string[],
    ...over,
  })

  it('before any submit there is NO outcome line — silence is not success', () => {
    const html = panel()
    expect(html).not.toContain('data-override-outcome')
    expect(html).not.toContain('data-override-refusal')
  })

  it('no_changes: its own branch, and it does NOT say "saved"; a write that did not happen walked past nothing', () => {
    const html = panel({ outcome: result({ no_changes: true, bypassed: ['week_final'] }) })
    expect(html).toContain('data-override-outcome="no_changes"')
    expect(html).toContain(NO_CHANGES_COPY)
    expect(between(html, 'data-override-outcome', '</div>')).not.toMatch(/saved/i)
    expect(html).not.toContain('data-override-bypassed')
  })

  it('live scoring stopped (Q61): the freeze sentence, in caution', () => {
    const html = panel({ outcome: result({ live_scoring_frozen: true, live_scoring_frozen_why: 'frozen_by_this_override — …' }) })
    expect(html).toContain('data-override-outcome="live_scoring_stopped"')
    expect(html).toContain(LIVE_SCORING_STOPPED_COPY)
    expect(html).toMatch(/bg-caution-soft[^>]*data-override-outcome/)
  })

  it('standings rebuilt (a final week), with the bypassed rules rendered back', () => {
    const html = panel({ outcome: result({ standings_rebuilt: true, bypassed: ['week_final', 'matchup_final'] }) })
    expect(html).toContain('data-override-outcome="standings_rebuilt"')
    expect(html).toContain(STANDINGS_REBUILT_COPY)
    expect(between(html, 'data-override-bypassed', '</span>')).toContain('This correction walked past: week_final, matchup_final.')
  })

  it('standings will follow at finalization', () => {
    const html = panel({ outcome: result({ live_scoring_frozen_why: 'matchup_already_final — …' }) })
    expect(html).toContain('data-override-outcome="standings_at_finalization"')
    expect(html).toContain(STANDINGS_AT_FINALIZATION_COPY)
  })

  it('will be overwritten (126’s not_frozen): said in caution, never as a clean save', () => {
    const html = panel({ outcome: result({ live_scoring_frozen_why: 'not_frozen — the override flag was NOT set' }) })
    expect(html).toContain('data-override-outcome="will_be_overwritten"')
    expect(html).toContain(WILL_BE_OVERWRITTEN_COPY)
  })

  it('NO saved branch renders a bare "Saved." — each line carries its consequence', () => {
    for (const outcome of [result({ live_scoring_frozen: true }), result({ standings_rebuilt: true }), result(), result({ live_scoring_frozen_why: 'not_frozen — x' })]) {
      const line = between(panel({ outcome }), '<span>Saved', '</span>')
      expect(line.length).toBeGreaterThan('<span>Saved.'.length + 20)
    }
  })

  it('a refusal is the verb’s text VERBATIM in an alert, and it REPLACES any outcome line', () => {
    const text = 'commish_set_result: winner 123 is not a side of matchup m1'
    const html = panel({ refusal: text, outcome: result({ standings_rebuilt: true }) })
    expect(between(html, 'data-override-refusal', '</p>')).toContain(text)
    expect(html).toMatch(/role="alert"[^>]*data-override-refusal/)
    expect(html).not.toContain('data-override-outcome')
  })

  it('while a submit is in flight every control is disabled and the score button says Saving…', () => {
    const html = panel({ pending: 'score' })
    expect(between(html, 'data-override-arm="score"', '</form>')).toContain('Saving…')
    expect([...html.matchAll(/<button[^>]*\sdisabled=""/g)]).toHaveLength(3)
    expect([...html.matchAll(/<input[^>]*\sdisabled=""/g)]).toHaveLength(2)
    // premise: idle, none of them is.
    expect([...panel().matchAll(/<(button|input)[^>]*\sdisabled=""/g)]).toHaveLength(0)
  })
})
