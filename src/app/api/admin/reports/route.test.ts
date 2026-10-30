/**
 * Admin › Reports' routes (Community launch plan C10). Pinned:
 *  - the gate first: anyone who isn't an admin gets 404 and nothing is read
 *    or called;
 *  - GET reads `content_reports` with the service role, newest first, with
 *    the total and the "new" count; before migration 214 is pushed (the
 *    table missing) it is a 503, never an empty list; any other failure 500;
 *  - Mark reviewed calls 214's `mark_content_report_reviewed` with the
 *    ADMIN'S OWN session (it stamps `auth.uid()`), and passes its answer on;
 *  - Remove reads which comment from the report itself, then calls 213's
 *    `remove_list_comment` with the admin's own session (C2's operator
 *    permission — 214 then stamps the reports reviewed); only a comment
 *    report can be removed; the database's refusals come back in its words.
 */
import { NextResponse } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const gate = vi.fn()
const serviceFrom = vi.fn()
vi.mock('@/lib/auth/require-admin', () => ({ requireAdminUser: () => gate() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from: serviceFrom }) }))

import { GET } from './route'
import { POST } from './[id]/route'

const REPORT = '0a01e5a6-e933-417a-b6ae-d6d8cb0c3c50'
const LIST = 'a2140000-0000-4000-8000-000000000010'
const COMMENT = 'c2140000-0000-4000-8000-000000000020'

/** A chainable PostgREST stand-in: records calls, resolves to `result`. */
function builder(result: unknown) {
  const calls: [string, unknown[]][] = []
  const b: Record<string, unknown> = {}
  for (const m of ['select', 'order', 'limit', 'is', 'in', 'eq']) {
    b[m] = (...args: unknown[]) => {
      calls.push([m, args])
      return b
    }
  }
  b.maybeSingle = () => Promise.resolve(result)
  b.then = (resolve: (v: unknown) => unknown) => resolve(result)
  return { b, calls }
}

let rpc: ReturnType<typeof vi.fn>
beforeEach(() => {
  gate.mockReset()
  serviceFrom.mockReset()
  rpc = vi.fn()
  gate.mockResolvedValue({ ok: true, user: { id: 'u-admin' }, supabase: { rpc } })
})

const post = (body: unknown, id = REPORT) =>
  POST(new Request(`http://localhost/api/admin/reports/${id}`, { method: 'POST', body: JSON.stringify(body) }), {
    params: Promise.resolve({ id }),
  })

describe('the admin gate', () => {
  it('a non-admin gets 404 from both, and nothing is read or called', async () => {
    gate.mockResolvedValue({ ok: false, response: NextResponse.json({ error: 'Not found' }, { status: 404 }) })
    expect((await GET()).status).toBe(404)
    expect((await post({ action: 'review' })).status).toBe(404)
    expect((await post({ action: 'remove' })).status).toBe(404)
    expect(serviceFrom).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })
})

describe('GET /api/admin/reports', () => {
  it('every report, newest first, with what each is about — read with the service role', async () => {
    const reports = builder({
      data: [
        {
          id: REPORT,
          reporter_id: 'u-dev',
          target_type: 'comment',
          target_id: COMMENT,
          list_id: LIST,
          reason: 'abusive',
          note: 'Rude to everyone',
          created_at: '2026-10-29T20:00:00Z',
          reviewed_at: null,
          reviewed_by: null,
        },
      ],
      error: null,
      count: 1,
    })
    const open = builder({ data: null, error: null, count: 1 })
    const lists = builder({ data: [{ id: LIST, title: 'RB sleepers', owner_id: 'u-kelly', is_private: false, deleted_at: null }], error: null })
    const comments = builder({ data: [{ id: COMMENT, author_id: 'u-sam', body: 'You stink', deleted_at: null }], error: null })
    const profiles = builder({
      data: [
        { id: 'u-dev', username: 'dev_user' },
        { id: 'u-kelly', username: 'kelly' },
        { id: 'u-sam', username: 'sam' },
      ],
      error: null,
    })
    serviceFrom
      .mockReturnValueOnce(reports.b)
      .mockReturnValueOnce(open.b)
      .mockImplementation((table: string) => ({ lists: lists.b, list_comments: comments.b, profiles: profiles.b })[table])

    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(serviceFrom.mock.calls[0]).toEqual(['content_reports'])
    expect(reports.calls).toContainEqual(['order', ['created_at', { ascending: false }]])
    expect(reports.calls).toContainEqual(['limit', [200]])
    expect(open.calls).toContainEqual(['is', ['reviewed_at', null]])
    expect(body).toMatchObject({ total: 1, open: 1, limit: 200 })
    expect(body.reports).toEqual([
      {
        id: REPORT,
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
      },
    ])
  })

  it('before migration 214 is pushed: 503 "aren’t available yet" — never an empty list', async () => {
    serviceFrom.mockReturnValueOnce(
      builder({ data: null, error: { code: 'PGRST205', message: "Could not find the table 'public.content_reports' in the schema cache" }, count: null }).b,
    )
    const res = await GET()
    expect(res.status).toBe(503)
    expect((await res.json()).error).toContain('aren’t available yet')
  })

  it('any other failure is a loud 500, and so is a missing count', async () => {
    serviceFrom.mockReturnValueOnce(builder({ data: null, error: { code: 'XX000', message: 'boom' }, count: null }).b)
    expect((await GET()).status).toBe(500)
    serviceFrom.mockReturnValueOnce(builder({ data: [], error: null, count: null }).b)
    expect((await GET()).status).toBe(500)
  })

  it('no reports at all is a real answer: an empty list with a zero total', async () => {
    serviceFrom.mockReturnValueOnce(builder({ data: [], error: null, count: 0 }).b).mockReturnValueOnce(builder({ data: null, error: null, count: 0 }).b)
    const res = await GET()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ reports: [], total: 0, open: 0, limit: 200 })
  })
})

describe('POST /api/admin/reports/[id] — Mark reviewed', () => {
  it('calls mark_content_report_reviewed with the admin’s own session, and passes the answer on', async () => {
    rpc.mockResolvedValue({ data: { status: 'reviewed', report_id: REPORT, reviewed_at: '2026-10-29T21:00:00Z', reviewed_by: 'u-admin' }, error: null })
    const res = await post({ action: 'review' })
    expect(res.status).toBe(200)
    expect(rpc).toHaveBeenCalledWith('mark_content_report_reviewed', { p_report_id: REPORT })
    expect(serviceFrom).not.toHaveBeenCalled()
    expect(await res.json()).toEqual({ status: 'reviewed', reviewed_at: '2026-10-29T21:00:00Z' })
  })

  it('already reviewed is said, not hidden', async () => {
    rpc.mockResolvedValue({ data: { status: 'already_reviewed', reviewed_at: '2026-10-28T09:00:00Z' }, error: null })
    expect(await (await post({ action: 'review' })).json()).toEqual({ status: 'already_reviewed', reviewed_at: '2026-10-28T09:00:00Z' })
  })

  it('before the push (PGRST202): 503; a missing report: 404 in the database’s words; an unknown answer: 500', async () => {
    rpc.mockResolvedValueOnce({
      data: null,
      error: { code: 'PGRST202', message: 'Could not find the function public.mark_content_report_reviewed(p_report_id) in the schema cache', hint: null },
    })
    expect((await post({ action: 'review' })).status).toBe(503)
    rpc.mockResolvedValueOnce({ data: null, error: { code: 'P0002', message: 'That report isn’t there.' } })
    const missing = await post({ action: 'review' })
    expect(missing.status).toBe(404)
    expect((await missing.json()).error).toBe('That report isn’t there.')
    rpc.mockResolvedValueOnce({ data: { status: 'something' }, error: null })
    expect((await post({ action: 'review' })).status).toBe(500)
  })
})

describe('POST /api/admin/reports/[id] — Remove (a reported comment)', () => {
  const reportRow = (over: Record<string, unknown> = {}) =>
    builder({ data: { id: REPORT, target_type: 'comment', target_id: COMMENT, list_id: LIST, ...over }, error: null })

  it('reads which comment from the report, then calls remove_list_comment with the admin’s own session', async () => {
    const read = reportRow()
    serviceFrom.mockReturnValueOnce(read.b)
    rpc.mockResolvedValue({
      data: { comment_id: COMMENT, list_id: LIST, removed_at: '2026-10-29T21:00:00Z', removed_as: 'operator', reports_reviewed: 2 },
      error: null,
    })
    const res = await post({ action: 'remove' })
    expect(res.status).toBe(200)
    expect(serviceFrom).toHaveBeenCalledWith('content_reports')
    expect(read.calls).toContainEqual(['eq', ['id', REPORT]])
    expect(rpc).toHaveBeenCalledWith('remove_list_comment', { p_list_id: LIST, p_comment_id: COMMENT })
    expect(await res.json()).toEqual({ status: 'removed', removed_as: 'operator', reports_reviewed: 2 })
  })

  it('a list report can’t be removed from here — 400, and nothing is called', async () => {
    serviceFrom.mockReturnValueOnce(reportRow({ target_type: 'list', target_id: LIST }).b)
    expect((await post({ action: 'remove' })).status).toBe(400)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('a report that isn’t there: 404; the table not pushed yet: 503 — nothing called', async () => {
    serviceFrom.mockReturnValueOnce(builder({ data: null, error: null }).b)
    expect((await post({ action: 'remove' })).status).toBe(404)
    serviceFrom.mockReturnValueOnce(
      builder({ data: null, error: { code: '42P01', message: 'relation "public.content_reports" does not exist' } }).b,
    )
    expect((await post({ action: 'remove' })).status).toBe(503)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('the comment already gone: 404 in the database’s words — never "removed"', async () => {
    serviceFrom.mockReturnValueOnce(reportRow().b)
    rpc.mockResolvedValue({ data: null, error: { code: 'P0002', message: 'That comment isn’t there — it may already have been removed.' } })
    const res = await post({ action: 'remove' })
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe('That comment isn’t there — it may already have been removed.')
  })
})

describe('POST — the request', () => {
  it('an id that isn’t one: 404; an unknown action: 400 — nothing called', async () => {
    expect((await post({ action: 'review' }, 'not-a-uuid')).status).toBe(404)
    expect((await post({ action: 'delete-everything' })).status).toBe(400)
    expect(rpc).not.toHaveBeenCalled()
    expect(serviceFrom).not.toHaveBeenCalled()
  })
})
