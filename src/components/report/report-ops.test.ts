/**
 * Report (Community launch plan C10) — who sees it, and what each of the
 * database's answers shows. The answers are fed through C9's own
 * `reportOutcome` from the shapes 214 returns (measured through PostgREST on
 * the local stack, as in `report-content.test.ts`), so the whole path from
 * the RPC's answer to the toast, the "Reported" mark and the form is pinned:
 *  - hidden on your own things; signed out it signs you in; Community off,
 *    nowhere;
 *  - a new report: "Thanks — we'll take a look.", then Reported;
 *  - a repeat: "already reported", then Reported — nothing pretends to be new;
 *  - before 214 is pushed (PGRST202): "Reporting isn't available yet." and
 *    the control stays Report — never a pretend thanks, nor the desktop
 *    toast's green success check (the amber caution mark instead);
 *  - over the hourly limit: the database's reason in the normal ink toast
 *    with the caution mark, the form kept open with its note;
 *  - refused: the database's words.
 * Only an answer that went through (reported / already reported) may wear
 * the default toast and its success check.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

const flags = vi.hoisted(() => ({ community: true }))
vi.mock('@/lib/feature-flags', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/feature-flags')>()
  return {
    featureFlags: {
      ...actual.featureFlags,
      get community() {
        return flags.community
      },
    },
  }
})

import { REPORT_ALREADY, REPORT_THANKS, REPORT_UNAVAILABLE, reportOutcome } from '@/lib/community/report-content'
import { reportKey, useReportedStore, wasReported } from '@/stores/reported-store'

import { noteCounter, REPORT_NOT_SENT, reportAccess, reportResult, settleReport } from './report-ops'

const ID = '0a01e5a6-e933-417a-b6ae-d6d8cb0c3c50'
const LIST = 'a2140000-0000-4000-8000-000000000010'

afterEach(() => {
  flags.community = true
})

describe('who sees Report', () => {
  it('nobody on their own thing (prevent, don’t refuse)', () => {
    expect(reportAccess({ viewerId: 'u-me', ownerId: 'u-me' })).toBe('hidden')
  })
  it('everyone else does', () => {
    expect(reportAccess({ viewerId: 'u-me', ownerId: 'u-kelly' })).toBe('report')
    // Who made it isn't known yet: still offered (the database re-checks).
    expect(reportAccess({ viewerId: 'u-me', ownerId: null })).toBe('report')
  })
  it('signed out, it is there — and sends you to sign in', () => {
    expect(reportAccess({ viewerId: null, ownerId: 'u-kelly' })).toBe('sign-in')
    expect(reportAccess({ viewerId: undefined, ownerId: 'u-kelly' })).toBe('sign-in')
  })
  it('while Community is off, nowhere', () => {
    flags.community = false
    expect(reportAccess({ viewerId: 'u-me', ownerId: 'u-kelly' })).toBe('hidden')
    expect(reportAccess({ viewerId: null, ownerId: 'u-kelly' })).toBe('hidden')
  })
})

/** Settle one RPC answer and record what the viewer would see. */
function settle(data: unknown, error: Parameters<typeof reportOutcome>[1]) {
  const markReported = vi.fn()
  const notify = vi.fn()
  const close = vi.fn()
  const result = settleReport(reportOutcome(data, error), { markReported, notify, close })
  return { result, markReported, notify, close }
}

describe('what each answer shows', () => {
  it('a new report: the thanks line, the form closes, the control shows Reported', () => {
    const s = settle({ status: 'reported', report_id: ID, target_type: 'list', target_id: LIST }, null)
    expect(s.notify).toHaveBeenCalledWith({ title: REPORT_THANKS })
    expect(REPORT_THANKS).toBe('Thanks — we’ll take a look.')
    expect(s.markReported).toHaveBeenCalledTimes(1)
    expect(s.close).toHaveBeenCalledTimes(1)
  })

  it('already reported: says so, and shows Reported — no second thanks', () => {
    const s = settle({ status: 'already_reported', report_id: ID, target_type: 'comment', target_id: LIST }, null)
    expect(s.notify).toHaveBeenCalledWith({ title: REPORT_ALREADY })
    expect(s.notify).not.toHaveBeenCalledWith({ title: REPORT_THANKS })
    expect(s.markReported).toHaveBeenCalledTimes(1)
    expect(s.close).toHaveBeenCalledTimes(1)
  })

  it('before 214 is pushed (PGRST202 naming report_content): "Reporting isn’t available yet" — never Reported', () => {
    const s = settle(null, {
      code: 'PGRST202',
      message:
        'Could not find the function public.report_content(p_note, p_reason, p_target_id, p_target_type) in the schema cache',
      details: null,
      hint: null,
    })
    // The caution mark, never the default toast's green success check.
    expect(s.notify).toHaveBeenCalledWith({ title: REPORT_UNAVAILABLE, variant: 'caution' })
    expect(REPORT_UNAVAILABLE).toBe('Reporting isn’t available yet.')
    expect(s.markReported).not.toHaveBeenCalled()
    expect(s.close).toHaveBeenCalledTimes(1)
  })

  it('over the hourly limit: the database’s reason in the normal toast; the form stays open, nothing marked', () => {
    const s = settle(null, {
      code: 'rate_limited',
      message: 'You’ve sent a lot of reports — you can report again in 12 minutes.',
      details: 'retry_after_seconds=700',
      hint: null,
    })
    // The normal ink toast with the amber caution mark — no error glyph for a
    // wait, and not the success check either.
    expect(s.notify).toHaveBeenCalledWith({
      title: REPORT_NOT_SENT,
      description: 'You’ve sent a lot of reports — you can report again in 12 minutes.',
      variant: 'caution',
    })
    expect(s.markReported).not.toHaveBeenCalled()
    expect(s.close).not.toHaveBeenCalled()
  })

  it('refused — gone, or your own after all: the database’s words; the form closes, nothing marked', () => {
    for (const error of [
      { code: 'P0002', message: 'That isn’t there to report — it may have been removed.' },
      { code: '42501', message: 'You can’t report your own list.' },
    ]) {
      const s = settle(null, { ...error, details: null, hint: null })
      expect(s.notify).toHaveBeenCalledWith({ title: REPORT_NOT_SENT, description: error.message, variant: 'destructive' })
      expect(s.markReported).not.toHaveBeenCalled()
      expect(s.close).toHaveBeenCalledTimes(1)
    }
  })

  it('a refused note (too long) keeps the form open so it can be fixed', () => {
    const s = settle(null, { code: '22001', message: 'Keep the note to 500 characters or fewer.', details: null, hint: null })
    expect(s.close).not.toHaveBeenCalled()
    expect(s.markReported).not.toHaveBeenCalled()
  })

  it('only an answer that went through wears the default toast (desktop: the green success check)', () => {
    const answers: Array<[unknown, Parameters<typeof reportOutcome>[1]]> = [
      [{ status: 'reported', report_id: ID, target_type: 'list', target_id: LIST }, null],
      [{ status: 'already_reported', report_id: ID, target_type: 'list', target_id: LIST }, null],
      [null, { code: 'PGRST202', message: 'Could not find the function public.report_content(p_note, p_reason, p_target_id, p_target_type) in the schema cache', details: null, hint: null }],
      [null, { code: 'rate_limited', message: 'You’ve sent a lot of reports.', details: 'retry_after_seconds=700', hint: null }],
      [null, { code: 'P0002', message: 'That isn’t there to report — it may have been removed.', details: null, hint: null }],
      [null, { code: '22001', message: 'Keep the note to 500 characters or fewer.', details: null, hint: null }],
      [{ status: 'weird' }, null],
    ]
    for (const [data, error] of answers) {
      const { toast, reported } = reportResult(reportOutcome(data, error))
      // The default variant (no variant at all) is the success mark: only for a report that's in.
      expect(toast.variant === undefined, `${JSON.stringify(error ?? data)}`).toBe(reported)
    }
  })

  it('an answer nobody knows is never shown as sent', () => {
    expect(reportResult(reportOutcome({ status: 'weird' }, null))).toEqual({
      toast: { title: REPORT_NOT_SENT, description: 'Couldn’t confirm the report was sent. Try again.', variant: 'destructive' },
      reported: false,
      close: false,
    })
  })
})

describe('Reported, this session', () => {
  it('is per person and per thing', () => {
    const key = reportKey('u-me', 'list', LIST)
    useReportedStore.getState().markReported(key)
    const { reported } = useReportedStore.getState()
    expect(wasReported(reported, 'u-me', 'list', LIST)).toBe(true)
    // Another person on the same tab, the same id as a comment, or signed out: not reported.
    expect(wasReported(reported, 'u-kelly', 'list', LIST)).toBe(false)
    expect(wasReported(reported, 'u-me', 'comment', LIST)).toBe(false)
    expect(wasReported(reported, null, 'list', LIST)).toBe(false)
  })
})

describe('the note', () => {
  it('counts up to 500', () => {
    expect(noteCounter('', 500)).toBe('0 / 500')
    expect(noteCounter('rude', 500)).toBe('4 / 500')
  })
})
