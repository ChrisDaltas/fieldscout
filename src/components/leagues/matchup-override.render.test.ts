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
 *
 * L.E1.18 (Q61 RULED, migration 135): with the mode ON the panel asks the
 * server whether the matchup's games have finished
 * (`useCommishMatchupEditLock`); the rig seeds that read as EDITABLE by
 * default so the cells above keep rendering the controls, and the §Q61 block
 * below renders the LOCKED, CHECKING and UNKNOWN states.
 *   P13 — offer the controls while `locked` → the locked cell reds.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import type { LeagueDetail } from '@/hooks/use-league'
import { leaguesKeys } from '@/hooks/use-leagues'
import { commishMatchupLockKeys } from '@/hooks/use-commish-matchup-lock'
import { leagueMatchupKeys } from '@/hooks/use-matchups'
import { scheduleKeys, type LeagueSchedule } from '@/hooks/use-schedule'
import type { WeekMatchups } from '@/lib/leagues/api/matchups-service'
import { defaultsForTeamCount } from '@/lib/leagues/settings/league-settings'
import { useOverrideMode } from '@/stores/commish-override-store'

import {
  BYE_ROW_COPY,
  LIVE_SCORING_STOPPED_COPY,
  LOCK_CHECKING_COPY,
  NO_CHANGES_COPY,
  STANDINGS_AT_FINALIZATION_COPY,
  STANDINGS_REBUILT_COPY,
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

/** 135's read document for one matchup (the fields the panel reads). */
function lockDoc(matchupId: string, editable: boolean, message: string | null = null, why?: string) {
  return { league_id: LEAGUE, matchup_id: matchupId, season: 2099, week: 1, editable, why: why ?? (editable ? 'every_starter_finished' : 'starters_not_finished'), week_status: 'live', starters: 2, finished: editable ? 2 : 1, not_finished: editable ? 0 : 1, still_playing: [], no_lineup: [], week_games_over: false, no_starter_game_sides: [], open_slots: [], message }
}

function renderPage(
  seed: { detail?: LeagueDetail; week?: WeekMatchups; matchupId?: string | null; overrideMode?: boolean; lock?: ReturnType<typeof lockDoc> | 'unanswered' } = {},
): string {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, retryOnMount: false } } })
  qc.setQueryData(leaguesKeys.detail(LEAGUE), seed.detail ?? detailAs('commissioner'))
  qc.setQueryData(scheduleKeys.all(LEAGUE), SCHEDULE)
  qc.setQueryData(leagueMatchupKeys.week(LEAGUE, 1), seed.week ?? weekDoc())
  // L.E1.18: the panel's server read — EDITABLE unless the cell says otherwise.
  if (seed.lock !== 'unanswered') {
    for (const id of ['m1', 'm2']) qc.setQueryData(commishMatchupLockKeys.one(LEAGUE, 1, id), seed.lock ?? lockDoc(id, true))
  }
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

// League UX batch 1 (Chris 2026-10-03): the override switch lives in League
// settings / the Commissioner console ONLY, and the league header shows it
// while it is on. The matchup page carries NO switch in any state; with the
// mode on, the commissioner's correction panel opens here as before.
describe('override MODE on the matchup page — no switch here, every week state, commissioner only (rule (h))', () => {
  it('PREMISE: the page renders the viewer’s matchup, and un-mocked the mode is OFF', () => {
    const html = renderPage()
    expect(html).toContain('data-matchup="m1"')
    expect(html).toContain('data-matchup-override="m1"')
    expect(html).toContain('data-override-mode="off"')
  })

  it('NO switch in ANY week state — upcoming, live, correction window, final — and OFF mounts no panel', () => {
    for (const status of ['upcoming', 'live', 'correction_window', 'final']) {
      const html = renderPage({
        week: weekDoc({
          league_week: { status, median_score: null, finalized_at: null },
          matchups: [{ ...M1, status: status === 'final' ? 'final' : 'live' }],
        }),
      })
      expect(html, status).toContain(`data-week-badge="${status === 'correction_window' ? 'pending_corrections' : status}"`) // premise: the state is the one named
      expect(html, status).not.toContain('data-override-toggle')
      expect(html, status).not.toContain('Turn on override mode')
      // OFF: no panel, no fields, nothing to submit.
      expect(html, status).not.toContain('data-override-panel')
      expect(html, status).not.toContain('<input')
    }
  })

  it('a co-commissioner gets it too; a MANAGER sees none of it — not even with the store saying ON', () => {
    expect(renderPage({ detail: detailAs('co_commissioner'), overrideMode: true })).toContain('data-override-panel')
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

  it('ON: the frame marks the panel, there is still no switch on the page, and the panel opens with BOTH scores and the winner arm', () => {
    const html = renderPage({ overrideMode: true })
    expect(html).toContain('data-override-mode="on"')
    expect(html).not.toContain('data-override-toggle')
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
    expect(off).not.toContain('border-brand-strong')
  })

  it('A11Y: each score field has a label bound to it', () => {
    const on = renderPage({ overrideMode: true })
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

  it('a BYE row (F366, fixed): the mode switches, the panel offers the HOME score alone — no away field, no winner arm — and the bye line says why', () => {
    const on = renderPage({ overrideMode: true, week: weekDoc({ matchups: [{ ...M1, away_team_id: null, away_score: null }] }) })
    expect(on).toContain('data-override-panel')
    expect(on).toContain('data-score-input="home"')
    expect(on).not.toContain('data-score-input="away"')
    expect(on).not.toContain('data-override-arm="result"')
    expect(on).not.toContain('data-declare-winner')
    expect(on).toContain('data-override-bye')
    expect(on).toContain(BYE_ROW_COPY)
    expect(BYE_ROW_COPY).not.toMatch(/yet|not available/)
  })
})

describe('the ✸ Adjusted marker is present EXACTLY when `is_overridden` is (the flag’s first reader)', () => {
  it('flag false ⇒ absent everywhere; true on the selected row ⇒ its chip only; true on another row ⇒ that row’s ✸ only', () => {
    const clean = renderPage()
    expect(clean).not.toContain('data-overridden')
    expect(clean).not.toContain('✸')

    const selected = renderPage({ week: weekDoc({ matchups: [{ ...M1, is_overridden: true }, M2] }) })
    expect([...selected.matchAll(/data-overridden=/g)]).toHaveLength(1)
    expect(between(selected, 'data-matchup="m1"', 'data-board')).toContain('✸ Adjusted')
    // L.E1.34 (F233(d), §10.3): the ✸ lands on the log — this week, this matchup's teams.
    expect(between(selected, 'data-matchup="m1"', 'data-board')).toMatch(/data-overridden-link="true" href="\/app\/leagues\/[^"]+\/activity\?tab=commissioner&week=\d+&team=[^"]+"/)
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

  it('L.E1.18: the "will be overwritten" line is GONE — 126’s `not_frozen` cannot come back since Q61’s ruling (135 sets the flag as the literal TRUE; pgTAP 083 F8/F9)', () => {
    const html = panel({ outcome: result({ live_scoring_frozen_why: 'not_frozen — the override flag was NOT set' }) })
    expect(html).not.toContain('will_be_overwritten')
    expect(html).not.toMatch(/overwrite/i)
  })

  it('NO saved branch renders a bare "Saved." — each line carries its consequence', () => {
    for (const outcome of [result({ live_scoring_frozen: true }), result({ standings_rebuilt: true }), result()]) {
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

// ---------------------------------------------------------------------------
// Q61, AS RULED (L.E1.18, migration 135) — the controls wait for the games
// ---------------------------------------------------------------------------

describe('Q61 — no score or winner control while a starter is still playing (the server says which)', () => {
  const LINE = 'This matchup can be corrected once every starter’s game has finished — not finished yet: LK Monday Jet (NYJ)'

  it('LOCKED: the mode is on, the panel says the server’s one line VERBATIM, and offers NO score field, NO Save and NO winner button', () => {
    const html = renderPage({ overrideMode: true, lock: lockDoc('m1', false, LINE) })
    expect(html).toContain('data-override-mode="on"') // premise: the mode is on
    expect(html).toContain('data-override-panel') // premise: the panel mounted
    expect(between(html, 'data-override-lock="locked"', '</p>')).toContain(LINE)
    expect(html).not.toContain('data-override-arm="score"')
    expect(html).not.toContain('data-save-scores')
    expect(html).not.toContain('data-declare-winner')
    expect(html).not.toContain('<input')
  })

  it('LOCKED, `lineup_not_set` (R1097): a side with NO lineup row — the server’s sentence VERBATIM, and NO score field, Save or winner button', () => {
    const NO_LINEUP = 'This matchup can be corrected once every starter’s game has finished — no lineup set yet: Bravo'
    const html = renderPage({ overrideMode: true, lock: lockDoc('m1', false, NO_LINEUP, 'lineup_not_set') })
    expect(html).toContain('data-override-panel') // premise: the panel mounted
    expect(between(html, 'data-override-lock="locked"', '</p>')).toContain(NO_LINEUP)
    expect(html).not.toContain('data-override-arm="score"')
    expect(html).not.toContain('data-save-scores')
    expect(html).not.toContain('data-declare-winner')
    expect(html).not.toContain('<input')
  })

  it('LOCKED, `no_starter_game` (Q67 / R1140, migration 142): a starting slot EMPTY or holding a player on bye while the week still has games — the server’s sentence VERBATIM, and NO score field, Save or winner button', () => {
    const NO_STARTER = 'This matchup can be corrected once every starter’s game has finished — empty starting slot: Bravo (WR); starter with no game this week: Bravo (LK Bye Packer, GB); not finished yet: LK Monday Jet (NYJ)'
    const html = renderPage({ overrideMode: true, lock: lockDoc('m1', false, NO_STARTER, 'no_starter_game') })
    expect(html).toContain('data-override-panel') // premise: the panel mounted
    expect(between(html, 'data-override-lock="locked"', '</p>')).toContain(NO_STARTER)
    expect(html).not.toContain('data-override-arm="score"')
    expect(html).not.toContain('data-save-scores')
    expect(html).not.toContain('data-declare-winner')
    expect(html).not.toContain('<input')
  })

  it('OPEN (the server says every starter has finished): the controls are there and no lock line is', () => {
    const html = renderPage({ overrideMode: true })
    expect(html).toContain('data-override-arm="score"')
    expect(html).toContain('data-declare-winner="home"')
    expect(html).not.toContain('data-override-lock')
  })

  it('CHECKING (the read has not answered): no controls on a guess — one line says it is checking', () => {
    const html = renderPage({ overrideMode: true, lock: 'unanswered' })
    expect(html).toContain('data-override-lock="checking"')
    expect(html).toContain(LOCK_CHECKING_COPY)
    expect(html).not.toContain('data-override-arm="score"')
    expect(html).not.toContain('data-declare-winner')
  })

  it('OFF: the read is not needed and nothing about it renders', () => {
    const html = renderPage({ lock: lockDoc('m1', false, LINE) })
    expect(html).not.toContain('data-override-lock')
  })

  it('UNKNOWN (the read failed — R1098): the failure is said as an alert and NO score field, Save or winner button is offered; a verb refusal still renders verbatim', () => {
    const html = unescapeHtml(
      renderToStaticMarkup(
        createElement(MatchupOverridePanelView, {
          homeName: 'Alpha',
          awayName: 'Bravo',
          homeDraft: '1',
          awayDraft: '2',
          onHomeDraft: () => {},
          onAwayDraft: () => {},
          pending: null,
          lock: { kind: 'unknown', message: 'Couldn’t check this matchup’s games — boom' },
          outcome: null,
          refusal: LINE,
          onSaveScores: () => {},
          onDeclareWinner: () => {},
        }),
      ),
    )
    expect(html).toMatch(/role="alert"[^>]*data-override-lock="unknown"/)
    expect(between(html, 'data-override-lock="unknown"', '</p>')).toContain('Couldn’t check this matchup’s games — boom')
    expect(html).not.toContain('data-override-arm="score"')
    expect(html).not.toContain('data-save-scores')
    expect(html).not.toContain('data-declare-winner')
    expect(html).not.toContain('<input')
    expect(between(html, 'data-override-refusal', '</p>')).toContain(LINE)
  })
})

// ---------------------------------------------------------------------------
// §10.4 — declaring a winner asks first, with the before → after (M6 L.E1.33)
// ---------------------------------------------------------------------------

describe('declare a winner — the before → after confirmation (§10.4; C82: nothing else asked)', () => {
  const base: Parameters<typeof MatchupOverridePanelView>[0] = {
    homeName: 'Alpha',
    awayName: 'Bravo',
    homeDraft: '98.4',
    awayDraft: '97.1',
    onHomeDraft: () => {},
    onAwayDraft: () => {},
    pending: null,
    outcome: null,
    refusal: null,
    onSaveScores: () => {},
    onDeclareWinner: () => {},
    stored: { home_score: 98.4, away_score: 97.1, result: null },
  }
  const panel = (over: Partial<typeof base> = {}) =>
    renderToStaticMarkup(createElement(MatchupOverridePanelView, { ...base, ...over })).replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&')

  it('no confirmation until a winner is chosen — the two declare buttons only ask', () => {
    const html = panel()
    expect(html).toContain('data-declare-winner="home"')
    expect(html).not.toContain('data-declare-confirm')
  })

  it('choosing Bravo shows the STORED before and what the result arm writes after — and a yes / cancel, no field', () => {
    const html = panel({ confirming: 'away' })
    const confirm = html.slice(html.indexOf('data-declare-confirm'))
    expect(confirm).toContain('Declare Bravo the winner?')
    expect(confirm).toContain('Now: Alpha 98.40 – 97.10 Bravo · no result recorded yet.')
    expect(confirm).toContain('After: Bravo wins this matchup. The scores stay as they are, and the change is shown to the league.')
    expect(confirm).toContain('data-declare-confirm-yes')
    expect(confirm).toContain('Yes, declare Bravo the winner')
    expect(confirm).toContain('data-declare-confirm-cancel')
    expect(confirm.slice(0, confirm.indexOf('</div></div>'))).not.toContain('<input')
  })

  it('the before names a result already recorded, and an unscored side as a dash — never a zero', () => {
    expect(panel({ confirming: 'home', stored: { home_score: 88, away_score: 90.5, result: 'away' } })).toContain('Now: Alpha 88.00 – 90.50 Bravo · Bravo won.')
    expect(panel({ confirming: 'home', stored: { home_score: null, away_score: 12, result: null } })).toContain('Now: Alpha — – 12.00 Bravo')
  })
})
