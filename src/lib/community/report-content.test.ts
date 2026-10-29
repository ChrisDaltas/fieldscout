/**
 * The client door to 214's `report_content` (Community launch plan C9):
 * every database answer becomes an outcome the Report UI shows as it is —
 * and nothing that isn't a written (or already written) report reads as one.
 * Error shapes are the ones measured through PostgREST on the local stack
 * (2026-10-29).
 */
import { describe, expect, it, vi } from 'vitest'

import {
  REPORT_ALREADY,
  REPORT_DOOR,
  REPORT_NOTE_MAX,
  REPORT_REASONS,
  REPORT_TARGET_TYPES,
  REPORT_THANKS,
  REPORT_UNAVAILABLE,
  reportArgs,
  reportContent,
  reportOutcome,
  reportRefusalCopy,
  type ReportRpcClient,
} from './report-content'

const ID = '0a01e5a6-e933-417a-b6ae-d6d8cb0c3c50'
const LIST = 'a2140000-0000-4000-8000-000000000010'

describe('the vocabulary mirrors 214', () => {
  it('three kinds of thing, three optional reasons in the sheet’s order, a 500-character note', () => {
    expect(REPORT_TARGET_TYPES).toEqual(['list', 'comment', 'start_sit'])
    expect(REPORT_REASONS.map((r) => `${r.value}:${r.label}`)).toEqual(['spam:Spam', 'abusive:Abusive', 'other:Something else'])
    expect(REPORT_NOTE_MAX).toBe(500)
  })

  it('the door names exactly the RPC’s four parameters', () => {
    expect(REPORT_DOOR).toEqual({ report_content: ['p_target_type', 'p_target_id', 'p_reason', 'p_note'] })
  })
})

describe('reportArgs', () => {
  it('sends the kind and id, and a reason and trimmed note only when there are some', () => {
    expect(reportArgs({ targetType: 'list', targetId: LIST })).toEqual({ p_target_type: 'list', p_target_id: LIST })
    expect(reportArgs({ targetType: 'comment', targetId: LIST, reason: 'abusive', note: '  rude  ' })).toEqual({
      p_target_type: 'comment',
      p_target_id: LIST,
      p_reason: 'abusive',
      p_note: 'rude',
    })
    expect(reportArgs({ targetType: 'start_sit', targetId: LIST, reason: null, note: '   ' })).toEqual({
      p_target_type: 'start_sit',
      p_target_id: LIST,
    })
  })
})

describe('reportOutcome — answers', () => {
  it('a new report: the thanks line', () => {
    expect(reportOutcome({ status: 'reported', report_id: ID, target_type: 'list', target_id: LIST }, null)).toEqual({
      kind: 'reported',
      reportId: ID,
      message: REPORT_THANKS,
    })
    expect(REPORT_THANKS).toBe('Thanks — we’ll take a look.')
  })

  it('a repeat: already reported, naming the first report — not an error', () => {
    expect(reportOutcome({ status: 'already_reported', report_id: ID }, null)).toEqual({
      kind: 'already_reported',
      reportId: ID,
      message: REPORT_ALREADY,
    })
  })

  it('an answer it doesn’t recognise is never shown as sent', () => {
    expect(reportOutcome(null, null).kind).toBe('error')
    expect(reportOutcome({ status: 'reported' }, null).kind).toBe('error')
    expect(reportOutcome({ status: 'queued', report_id: ID }, null).kind).toBe('error')
  })
})

describe('reportOutcome — refusals', () => {
  it('the hourly limit: the server’s wait and words', () => {
    expect(
      reportOutcome(null, {
        code: 'rate_limited',
        details: 'retry_after_seconds=3600',
        hint: null,
        message: "You've sent a lot of reports — you can report again in 60 minutes.",
      }),
    ).toEqual({
      kind: 'rate_limited',
      retryAfterSeconds: 3600,
      message: "You've sent a lot of reports — you can report again in 60 minutes.",
    })
  })

  it('the limit with no words of its own still says how long, in plain words', () => {
    expect(reportOutcome(null, { code: 'rate_limited', details: null, message: '' })).toEqual({
      kind: 'rate_limited',
      retryAfterSeconds: 3600,
      message: reportRefusalCopy(3600),
    })
    expect(reportRefusalCopy(3600)).toBe('You’ve sent a lot of reports — you can report again in 60 minutes.')
    expect(reportRefusalCopy(61)).toBe('You’ve sent a lot of reports — you can report again in 2 minutes.')
    expect(reportRefusalCopy(60)).toBe('You’ve sent a lot of reports — you can report again in 1 minute.')
    expect(reportRefusalCopy(1)).toBe('You’ve sent a lot of reports — you can report again in 1 second.')
  })

  it('the database’s own plain-words refusals, by kind', () => {
    expect(reportOutcome(null, { code: '42501', message: "You can't report your own list." })).toEqual({
      kind: 'refused',
      reason: 'not_allowed',
      message: "You can't report your own list.",
    })
    expect(reportOutcome(null, { code: '42501', message: 'Sign in to report something.' })).toMatchObject({
      kind: 'refused',
      reason: 'not_allowed',
    })
    expect(reportOutcome(null, { code: 'P0002', message: 'That isn\'t there to report — it may have been removed.' })).toMatchObject({
      kind: 'refused',
      reason: 'not_found',
    })
    expect(reportOutcome(null, { code: '22023', message: 'Pick Spam, Abusive or Something else — or leave the reason out.' })).toMatchObject({
      kind: 'refused',
      reason: 'invalid',
    })
    expect(reportOutcome(null, { code: '22001', message: 'Keep the note to 500 characters or fewer.' })).toMatchObject({
      kind: 'refused',
      reason: 'invalid',
    })
  })
})

describe('reportOutcome — before 214 is pushed', () => {
  it('the door missing (PGRST202 naming report_content with our own parameters): not available yet', () => {
    expect(
      reportOutcome(null, {
        code: 'PGRST202',
        details:
          'Searched for the function public.report_content with parameters p_target_id, p_target_type or with a single unnamed json/jsonb parameter, but no matches were found in the schema cache.',
        hint: null,
        message: 'Could not find the function public.report_content(p_target_id, p_target_type) in the schema cache',
      }),
    ).toEqual({ kind: 'unavailable', message: REPORT_UNAVAILABLE })
    expect(REPORT_UNAVAILABLE).toBe('Reporting isn’t available yet.')
  })

  it('a call that drifted from the door is a loud error, never "not available yet"', () => {
    expect(
      reportOutcome(null, {
        code: 'PGRST202',
        details: 'Searched for the function public.report_content with parameters p_bogus, p_target_type …',
        hint: 'Perhaps you meant to call the function public.report_content(p_note, p_reason, p_target_id, p_target_type)',
        message: 'Could not find the function public.report_content(p_bogus, p_target_type) in the schema cache',
      }),
    ).toEqual({
      kind: 'error',
      message: 'Could not find the function public.report_content(p_bogus, p_target_type) in the schema cache',
    })
  })

  it('another missing function is not this door', () => {
    expect(
      reportOutcome(null, {
        code: 'PGRST202',
        hint: null,
        message: 'Could not find the function public.report_contents(p_target_id, p_target_type) in the schema cache',
      }).kind,
    ).toBe('error')
  })

  it('any other failure is loud and keeps the database’s words', () => {
    expect(reportOutcome(null, { code: '57014', message: 'canceling statement due to statement timeout' })).toEqual({
      kind: 'error',
      message: 'canceling statement due to statement timeout',
    })
    expect(reportOutcome(null, { code: 'XX000', message: '' })).toEqual({
      kind: 'error',
      message: 'Couldn’t send the report. Try again.',
    })
  })
})

describe('reportContent', () => {
  it('calls report_content once with the built arguments and returns the outcome', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { status: 'reported', report_id: ID }, error: null })
    const client: ReportRpcClient = { rpc }
    await expect(reportContent(client, { targetType: 'comment', targetId: LIST, reason: 'spam', note: ' x ' })).resolves.toEqual({
      kind: 'reported',
      reportId: ID,
      message: REPORT_THANKS,
    })
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('report_content', {
      p_target_type: 'comment',
      p_target_id: LIST,
      p_reason: 'spam',
      p_note: 'x',
    })
  })
})
