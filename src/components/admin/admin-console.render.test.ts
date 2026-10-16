/**
 * admin-console.render.test.ts — M8 L.G1.6's render proofs: the console's
 * presentational bodies over real payload shapes (186 / 182), one per state —
 * calm (nothing needs you), attention, overflow, loading, error (incl. the
 * pre-push 503), the league page's knobs (lineup locking run-now only; run
 * now hidden while paused), the notify preview as the rail renders it, and
 * the operator log with its overflow line. `renderToStaticMarkup`, as the
 * other render tests.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({ usePathname: () => '/app/admin', useRouter: () => ({ push: () => {} }) }))

import { AdminApiError } from '@/lib/admin/admin-api'

import { AdminHomeBody } from './admin-home'
import { AdminLeagueBody } from './admin-leagues'
import { LogBody } from './admin-log'
import { NotifyBody } from './admin-notify'
import { AdminError, AdminLoading, AdminTabs } from './admin-parts'
import { emptyNoticeDraft, type OpLeagueState, type OpPlatformState } from './admin-console-ops'

const LEAGUE = '5f0e8f43-0e7b-4a4c-a0f2-6f4a8a1f2c33'
const html = (el: ReactElement) =>
  renderToStaticMarkup(createElement(QueryClientProvider, { client: new QueryClient() }, el))
const noop = () => {}

const calm: OpPlatformState = {
  as_of: '2026-10-14T12:00:00Z',
  pauses: [],
  games: [],
  games_total: 0,
  games_limit: 200,
  live_weeks: [],
  pending: { waiver_claims: 0, players_waiting_to_be_rescored: 0 },
  cron: [{ job: 'waiver-tick', schedule: '*/5 * * * *', active: true, last_started_at: null, last_status: 'succeeded', last_message: null, summary: 'Last run worked' }],
}

describe('Admin home', () => {
  it('calm: says nothing needs you, no attention lists', () => {
    const out = html(createElement(AdminHomeBody, { state: calm, onConfirm: noop }))
    expect(out).toContain('data-admin-empty="attention"')
    expect(out).not.toContain('data-attention=')
    expect(out).toContain('data-admin-empty="games"')
  })

  it('attention: held weeks, pauses (linking their league), stalled jobs, marked games with their mark controls', () => {
    const state: OpPlatformState = {
      ...calm,
      pauses: [{ id: 'p1', job: 'waivers', league_id: LEAGUE, league_name: 'Sunday Funday', paused_at: calm.as_of, skipped_runs: 2, summary: 'Waivers paused by FieldScout for this league — 2 run(s) skipped' }],
      games: [
        { game_id: 'g1', matchup: 'KC @ BUF', kickoff_at: calm.as_of, status: 'postponed', operator_hold: null, holds_week: true, reason: 'Postponed, but its new kickoff is still this week — the week waits for it', season: 2026, week: 6 },
        { game_id: 'g2', matchup: 'NE @ NYJ', kickoff_at: calm.as_of, status: 'scheduled', operator_hold: 'cancelled', holds_week: false, reason: 'Marked by FieldScout: cancelled', season: 2026, week: 5 },
      ],
      games_total: 2,
      cron: [{ ...calm.cron[0], last_status: 'failed', last_message: 'timeout', summary: 'Last run FAILED' }],
    }
    const out = html(createElement(AdminHomeBody, { state, onConfirm: noop }))
    expect(out).toContain('data-held-week="2026-6"')
    expect(out).toContain(`href="/app/admin/leagues/${LEAGUE}"`)
    expect(out).toContain('data-stalled="waiver-tick"')
    expect(out).toContain('Last run failed: timeout')
    // g2 is cancelled: it can go back to normal, never re-offered "cancelled".
    const g2 = out.slice(out.indexOf('data-game="g2"'))
    expect(g2).toContain('data-mark="normal"')
    expect(g2.slice(0, g2.indexOf('</li>'))).not.toContain('data-mark="cancelled"')
    // Every-league knobs: lineup locking has run now only.
    const lock = out.slice(out.indexOf('data-job="lineup-lock"'))
    expect(lock.slice(0, lock.indexOf('</li>'))).not.toContain('data-knob="pause"')
    expect(lock.slice(0, lock.indexOf('</li>'))).toContain('data-knob="run_now"')
  })

  it('overflow: says how many games are not shown', () => {
    const games = [{ game_id: 'g', matchup: 'A @ B', kickoff_at: calm.as_of, status: 'scheduled', operator_hold: 'in_week' as const, holds_week: true, reason: 'x', season: 2026, week: 6 }]
    const out = html(createElement(AdminHomeBody, { state: { ...calm, games, games_total: 240 }, onConfirm: noop }))
    expect(out).toContain('data-overflow="games"')
    expect(out).toContain('Showing the first 1 of 240 games.')
  })
})

describe('loading / error / tabs', () => {
  it('loading is skeletons, an error is loud with Retry, and the pre-push 503 has no Retry', () => {
    expect(html(createElement(AdminLoading, { label: 'x' }))).toContain('aria-busy="true"')
    const failed = html(createElement(AdminError, { error: new AdminApiError(500, 'boom'), onRetry: noop, what: 'the platform view' }))
    expect(failed).toContain('data-admin-error="failed"')
    expect(failed).toContain('boom')
    expect(failed).toContain('Retry')
    const later = html(createElement(AdminError, { error: new AdminApiError(503, 'The live-state view is not available yet.'), onRetry: noop, what: 'x' }))
    expect(later).toContain('data-admin-error="unavailable"')
    expect(later).not.toContain('Retry')
  })

  it('the tabs keep persona-post review, and mark the current page', () => {
    const out = html(createElement(AdminTabs))
    expect(out).toContain('href="/app/admin/posts"')
    expect(out).toMatch(/aria-current="page"[^>]*href="\/app\/admin"|href="\/app\/admin"[^>]*aria-current="page"/)
  })
})

const league: OpLeagueState = {
  as_of: calm.as_of,
  league: { id: LEAGUE, name: 'Sunday Funday', season: 2026, status: 'in_season' },
  weeks: [{ season: 2026, week: 6, status: 'live', summary: 'Being played' }],
  open_weeks: [{ season: 2026, week: 6, status: 'live', players_waiting_to_be_rescored: 0, games: [] }],
  pending: { waiver_claims: 4, next_waiver_run_at: null },
  pauses: [{ id: 'p1', job: 'waivers', league_id: LEAGUE, paused_at: calm.as_of, skipped_runs: 0, summary: 'Waivers paused by FieldScout for this league' }],
  cron: [],
  commissioner_receipts: [{ id: 'c1', at: calm.as_of, action: 'edit_lineup', actor: 'chris', reason: null }],
  operator_receipts: [],
  receipts_limit: 20,
}

describe('League page', () => {
  it('paused waivers offer Resume and no Run now (run now never bypasses a pause); other jobs offer Pause + Run now', () => {
    const out = html(createElement(AdminLeagueBody, { state: league, onConfirm: noop }))
    const w = out.slice(out.indexOf('data-job="waivers"'))
    const wRow = w.slice(0, w.indexOf('</li>'))
    expect(wRow).toContain('data-knob="resume"')
    expect(wRow).not.toContain('data-knob="run_now"')
    const a = out.slice(out.indexOf('data-job="week-advance"'))
    const aRow = a.slice(0, a.indexOf('</li>'))
    expect(aRow).toContain('data-knob="pause"')
    expect(aRow).toContain('data-knob="run_now"')
  })

  it('empty states, and a commissioner’s username links to the profile', () => {
    const out = html(createElement(AdminLeagueBody, { state: league, onConfirm: noop }))
    expect(out).toContain('data-admin-empty="open-week-games"')
    expect(out).toContain('data-admin-empty="operator-receipts"')
    expect(out).toContain('href="/u/chris"')
  })
})

describe('Notify', () => {
  it('previews the notice exactly as the rail shows it, labelled From FieldScout', () => {
    const draft = { ...emptyNoticeDraft('0b6c2f5e-8f1a-4c1e-9d55-3a1c0e2b7d10'), title: 'Week 6 is delayed', body: 'Sorry!' }
    const out = html(createElement(NotifyBody, { draft, set: noop, problem: null, sent: null, sendError: null, onSend: noop, now: calm.as_of }))
    const preview = out.slice(out.indexOf('data-notify-preview'))
    expect(preview).toContain('data-notif-from-fieldscout="true"')
    expect(preview).toContain('Week 6 is delayed')
    expect(out).not.toContain('data-notify-problem')
  })

  it('a blocked send says why; a finished send reports the recipient count', () => {
    const draft = emptyNoticeDraft('0b6c2f5e-8f1a-4c1e-9d55-3a1c0e2b7d10')
    const blocked = html(createElement(NotifyBody, { draft, set: noop, problem: 'Add a title.', sent: null, sendError: null, onSend: noop }))
    expect(blocked).toContain('Add a title.')
    expect(blocked).toMatch(/disabled=""[^>]*data-notify-send|data-notify-send[^>]*disabled=""/)
    const sent = html(createElement(NotifyBody, { draft, set: noop, problem: 'Add a title.', sent: { recipients: 37, title: 'Hi' }, sendError: null, onSend: noop }))
    expect(sent).toContain('data-notify-sent="37"')
  })
})

describe('Operator log', () => {
  it('empty, rows in plain words, and the overflow line', () => {
    expect(html(createElement(LogBody, { page: { actions: [], total: 0, limit: 50 } }))).toContain('data-admin-empty="log"')
    const out = html(createElement(LogBody, {
      page: {
        actions: [{ id: '1', action_id: 'a', verb: 'pause_job', scope: 'league', league_id: LEAGUE, reason: 'storm', before: null, after: { job: 'waivers' }, created_at: calm.as_of }],
        total: 120,
        limit: 50,
      },
    }))
    expect(out).toContain('Paused a job')
    expect(out).toContain(`href="/app/admin/leagues/${LEAGUE}"`)
    expect(out).toContain('Showing the newest 1 of 120.')
  })
})
