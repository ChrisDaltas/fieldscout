/**
 * Admin › Reports (Community launch plan C10) — the page's body over the
 * route's real payload shape. Pinned:
 *  - each report: what it is, the reason (or "No reason given"), when, the
 *    words reported (a comment) or the list's title, who wrote it and who
 *    reported it — usernames are links to their profiles — and the note;
 *  - Open goes to the list inside the app (a comment opens its list); none
 *    for a list that's deleted, gone, or private and not yours;
 *  - Mark reviewed on an open report only; a reviewed one says by whom;
 *  - Remove only on a reported comment that's still up — the soft red tint,
 *    never a bright red fill, and it asks first;
 *  - before migration 214 is pushed the page says reports aren't available
 *    yet (a rounded notice), never a fake "no reports";
 *  - Admin home's Needs attention says "N new reports", linking here; the
 *    Reports tab and page ride the Community switch.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({ usePathname: () => '/app/admin/reports', useRouter: () => ({ push: () => {} }) }))
vi.mock('@/hooks/use-profile-href', () => ({ useProfileHref: (u: string) => `/app/u/${u}` }))
vi.mock('@/lib/feature-flags', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/feature-flags')>()
  return { featureFlags: { ...actual.featureFlags, community: true } }
})
// Radix portals don't render on the server: draw the confirm inline when open.
vi.mock('@/components/ui/dialog', async () => {
  const react = await import('react')
  const pass = (tag: string) => ({ children }: { children?: React.ReactNode }) => react.createElement(tag, null, children)
  return {
    Dialog: ({ open, children }: { open: boolean; children?: React.ReactNode }) =>
      open ? react.createElement('div', { 'data-dialog': '' }, children) : null,
    DialogContent: pass('section'),
    DialogHeader: pass('header'),
    DialogTitle: pass('h2'),
    DialogDescription: pass('p'),
    DialogFooter: pass('footer'),
  }
})

import type { AdminReport, AdminReportsPayload } from '@/lib/admin/content-reports'

import type { OpPlatformState } from './admin-console-ops'
import { AdminHomeBody } from './admin-home'
import { adminTabs } from './admin-parts'
import { actionToast, AdminReportsBody, newReportsWords, RemoveCommentDialog, reportOpenHref, ReportsUnavailable } from './admin-reports'

const LIST = 'a2140000-0000-4000-8000-000000000010'
const html = (el: ReactElement) =>
  renderToStaticMarkup(createElement(QueryClientProvider, { client: new QueryClient() }, el))
    .replace(/&#x27;/g, '’')
    .replace(/&quot;/g, '"')
const noop = () => {}

function report(over: Partial<AdminReport> = {}): AdminReport {
  return {
    id: 'r1',
    kind: 'comment',
    reason: 'abusive',
    note: 'Rude to everyone',
    created_at: '2026-10-29T20:00:00Z',
    reviewed_at: null,
    reviewer: null,
    reporter: 'dev_user',
    author: 'sam',
    list: { id: LIST, title: 'RB sleepers', own: false, state: 'live' },
    comment: { body: 'You stink', removed: false },
    ...over,
  }
}

const payload = (reports: AdminReport[], over: Partial<AdminReportsPayload> = {}): AdminReportsPayload => ({
  reports,
  total: reports.length,
  open: reports.filter((r) => !r.reviewed_at).length,
  limit: 200,
  ...over,
})

/** One row's markup. */
const rowOf = (out: string, id: string) => {
  const at = out.indexOf(`data-report-row="${id}"`)
  const next = out.indexOf('data-report-row="', at + 1)
  return out.slice(at, next === -1 ? undefined : next)
}

describe('a reported comment', () => {
  const out = html(createElement(AdminReportsBody, { payload: payload([report()]) }))
  const row = rowOf(out, 'r1')

  it('what it is, why, when — the words reported, on which list', () => {
    expect(row).toContain('>Comment<')
    expect(row).toContain('>Abusive<')
    expect(row).toContain('You stink')
    expect(row).toContain('“RB sleepers”')
    expect(row).toContain('Rude to everyone')
  })

  it('who wrote it and who reported it — each a link to the profile', () => {
    expect(row).toMatch(/Written by <a [^>]*data-username-link="sam"[^>]*href="\/app\/u\/sam"/)
    expect(row).toMatch(/Reported by <a [^>]*data-username-link="dev_user"[^>]*href="\/app\/u\/dev_user"/)
  })

  it('Open (its list, inside the app), Mark reviewed, and Remove comment in the soft red tint', () => {
    expect(row).toMatch(new RegExp(`<a data-report-open="true"[^>]*href="/app/explore\\?list=${LIST}"`))
    expect(row).toContain('data-report-review="true"')
    const remove = row.slice(row.lastIndexOf('<button', row.indexOf('data-report-remove')), row.indexOf('</button>', row.indexOf('data-report-remove')))
    expect(remove).toContain('bg-negative-soft')
    expect(remove).toContain('text-negative-strong')
    expect(remove).not.toMatch(/bg-negative-strong|bg-destructive|bg-\[#FF0028\]/)
  })

  it('"N new reports · N in all"', () => {
    expect(out).toContain('1 new report')
    expect(newReportsWords(3)).toBe('3 new reports')
  })
})

describe('the other states of a row', () => {
  it('a list report: its title, no Remove (lists are taken down by hand)', () => {
    const row = rowOf(html(createElement(AdminReportsBody, { payload: payload([report({ kind: 'list', comment: null, reason: null })]) })), 'r1')
    expect(row).toContain('>List<')
    expect(row).toContain('No reason given')
    expect(row).toContain('“RB sleepers”')
    expect(row).toContain('data-report-review="true"')
    expect(row).not.toContain('data-report-remove')
  })

  it('reviewed: says by whom (a link) — no Mark reviewed', () => {
    const row = rowOf(
      html(createElement(AdminReportsBody, { payload: payload([report({ reviewed_at: '2026-10-29T21:00:00Z', reviewer: 'chris' })]) })),
      'r1',
    )
    expect(row).toMatch(/Reviewed by <a [^>]*data-username-link="chris"/)
    expect(row).not.toContain('data-report-review="true"')
    expect(row).not.toContain('data-report-new')
  })

  it('a comment already removed: marked Removed, no Remove', () => {
    const row = rowOf(html(createElement(AdminReportsBody, { payload: payload([report({ comment: { body: 'You stink', removed: true } })]) })), 'r1')
    expect(row).toContain('data-report-removed')
    expect(row).not.toContain('data-report-remove="true"')
  })

  it('a deleted list (or a gone one): said so, and no Open', () => {
    for (const state of ['deleted', 'missing'] as const) {
      const r = report({ kind: 'list', comment: null, list: { id: LIST, title: state === 'missing' ? null : 'RB sleepers', own: false, state } })
      const row = rowOf(html(createElement(AdminReportsBody, { payload: payload([r]) })), 'r1')
      expect(row).toContain(state === 'deleted' ? 'Deleted' : 'No longer there')
      expect(row).not.toContain('data-report-open')
    }
  })

  it('Open: a private list opens only if it’s yours (in your Lists); someone else’s private list has no Open', () => {
    expect(reportOpenHref({ list: { id: LIST, title: 'x', own: false, state: 'private' } })).toBeNull()
    expect(reportOpenHref({ list: { id: LIST, title: 'x', own: true, state: 'private' } })).toBe(`/app/lists?list=${LIST}`)
    expect(reportOpenHref({ list: { id: LIST, title: 'x', own: true, state: 'live' } })).toBe(`/app/lists?list=${LIST}`)
    expect(reportOpenHref({ list: null })).toBeNull()
  })

  it('an account that’s gone reads "a deleted account", not a broken link', () => {
    const row = rowOf(html(createElement(AdminReportsBody, { payload: payload([report({ author: null })]) })), 'r1')
    expect(row).toContain('Written by <span class="text-n-6">a deleted account</span>')
  })
})

describe('the page’s states', () => {
  it('nobody has reported anything: a real empty answer, said plainly', () => {
    const out = html(createElement(AdminReportsBody, { payload: payload([]) }))
    expect(out).toContain('data-admin-empty="reports"')
    expect(out).toContain('Nobody has reported anything yet.')
  })

  it('more than 200: says it shows the newest 200 of all', () => {
    const out = html(createElement(AdminReportsBody, { payload: payload([report()], { total: 340 }) }))
    expect(out).toContain('Showing the newest 1 of 340 reports.')
  })

  it('before migration 214 is pushed: a rounded notice, not an error and not "no reports"', () => {
    const out = html(createElement(ReportsUnavailable))
    expect(out).toContain('Reports aren’t available yet.')
    expect(out).toContain('rounded-message')
    expect(out).not.toContain('rounded-pill')
    expect(out).not.toContain('Nobody has reported')
  })
})

describe('Remove asks first', () => {
  it('the confirm quotes the comment, says what happens, and its Remove is the soft tint', () => {
    const out = html(createElement(RemoveCommentDialog, { report: report(), busy: false, onCancel: noop, onConfirm: noop }))
    expect(out).toContain('Remove this comment?')
    expect(out).toContain('You stink')
    expect(out).toContain('marked reviewed by you')
    const go = out.slice(out.lastIndexOf('<button', out.indexOf('data-report-remove-go')), out.indexOf('</button>', out.indexOf('data-report-remove-go')))
    expect(go).toContain('bg-negative-soft')
    expect(go).not.toMatch(/bg-negative-strong|bg-destructive/)
    expect(html(createElement(RemoveCommentDialog, { report: null, busy: false, onCancel: noop, onConfirm: noop }))).toBe('')
  })

  it('the toasts say what the database did', () => {
    expect(actionToast('review', { status: 'reviewed' })).toEqual({ title: 'Marked reviewed' })
    expect(actionToast('review', { status: 'already_reviewed' }).title).toBe('Already reviewed')
    expect(actionToast('remove', { status: 'removed', removed_as: 'operator', reports_reviewed: 2 })).toEqual({
      title: 'Comment removed',
      description: '2 reports on it marked reviewed by you.',
    })
    // Removed as the list's owner: no report stamped — it says so.
    expect(actionToast('remove', { status: 'removed', removed_as: 'list_owner', reports_reviewed: 0 }).description).toBe(
      'This report is still open — mark it reviewed.',
    )
  })
})

describe('Admin home — Needs attention', () => {
  const calm: OpPlatformState = {
    as_of: '2026-10-29T12:00:00Z',
    pauses: [],
    games: [],
    games_total: 0,
    games_limit: 200,
    live_weeks: [],
    pending: { waiver_claims: 0, players_waiting_to_be_rescored: 0 },
    cron: [],
  }

  it('"N new reports", linking to Admin › Reports — and it isn’t "nothing needs you"', () => {
    const out = html(createElement(AdminHomeBody, { state: calm, onConfirm: noop, reports: { kind: 'open', count: 3 } }))
    expect(out).toContain('data-attention="reports"')
    expect(out).toMatch(/href="\/app\/admin\/reports"[^>]*>3 new reports</)
    expect(out).not.toContain('data-admin-empty="attention"')
  })

  it('none new: no line, and calm stays calm', () => {
    const out = html(createElement(AdminHomeBody, { state: calm, onConfirm: noop, reports: { kind: 'open', count: 0 } }))
    expect(out).not.toContain('data-attention="reports"')
    expect(out).toContain('data-admin-empty="attention"')
  })

  it('a failed read is loud — never a quiet zero; before the push it says so', () => {
    let out = html(createElement(AdminHomeBody, { state: calm, onConfirm: noop, reports: { kind: 'failed', message: 'boom' } }))
    expect(out).toContain('Couldn’t load reports.')
    expect(out).not.toContain('data-admin-empty="attention"')
    out = html(createElement(AdminHomeBody, { state: calm, onConfirm: noop, reports: { kind: 'unavailable' } }))
    expect(out).toContain('data-attention="reports-unavailable"')
  })

  it('with Community off (no reports read): exactly as before', () => {
    const out = html(createElement(AdminHomeBody, { state: calm, onConfirm: noop }))
    expect(out).not.toContain('reports')
  })
})

describe('the switch', () => {
  it('the Reports tab joins the admin tabs only while Community is on', () => {
    expect(adminTabs(true).map((t) => t.label)).toEqual(['Home', 'Leagues', 'Notify', 'Log', 'Posts', 'Reports'])
    expect(adminTabs(false).map((t) => t.label)).toEqual(['Home', 'Leagues', 'Notify', 'Log', 'Posts'])
  })

  it('the page is "not found" while Community is off; the admin layout already refuses non-admins', () => {
    const page = readFileSync(path.resolve(process.cwd(), 'src/app/app/(shell)/admin/reports/page.tsx'), 'utf8')
    expect(page).toContain('if (!featureFlags.community) notFound()')
    const layout = readFileSync(path.resolve(process.cwd(), 'src/app/app/(shell)/admin/layout.tsx'), 'utf8')
    expect(layout).toContain('if (!(await isAdminViewer())) notFound()')
  })
})
