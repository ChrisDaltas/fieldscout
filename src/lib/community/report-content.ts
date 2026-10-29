/**
 * Reporting — Community launch plan C9 (migration 214, `report_content`).
 *
 * A signed-in person reports a list, a comment or a start/sit question, with
 * an optional reason (Spam / Abusive / Something else) and an optional note
 * of at most 500 characters. The database decides everything: it re-checks
 * the thing is one the person can see and isn't theirs, spends one of their
 * 10 reports an hour, and rings the admins' bell. A repeat report of the
 * same thing does nothing and answers `already_reported`.
 *
 * This module is the one client door to it (C10's Report menus build on it):
 * `reportContent` calls the RPC with whatever client the caller holds and
 * turns every answer into a `ReportOutcome` the UI can show as it is — the
 * thanks line, the limit's wait, the database's own plain-words refusal, or
 * "Reporting isn't available yet".
 *
 * DEPLOY BEFORE PUSH: this code reaches fieldscout.gg before Chris pushes
 * 214, so the RPC can be missing for a while. That answer (PGRST202 naming
 * `report_content` with only this module's own parameters — `isDoorNotPushed`)
 * is `unavailable`, never a fake success; any other error is `error` and
 * carries the database's message.
 */
import { parseRateLimitRefusal, type PostgrestErrorShape } from '@/lib/rate-limit/rate-limit-refusal'
import { isDoorNotPushed } from '@/lib/supabase/postgrest-errors'

/** What can be reported — 214's `content_reports_target_type_known`. */
export const REPORT_TARGET_TYPES = ['list', 'comment', 'start_sit'] as const
export type ReportTargetType = (typeof REPORT_TARGET_TYPES)[number]

/** The optional reasons, in the order the Report sheet shows them (214's
 *  `content_reports_reason_known`; "Something else" is stored as `other`). */
export const REPORT_REASONS = [
  { value: 'spam', label: 'Spam' },
  { value: 'abusive', label: 'Abusive' },
  { value: 'other', label: 'Something else' },
] as const
export type ReportReason = (typeof REPORT_REASONS)[number]['value']

/** 214's note limit (the database refuses longer; blank is no note). */
export const REPORT_NOTE_MAX = 500

/** 213's 'report' bucket: 10 per hour per person — the fallback wait when a
 *  refusal's own wait can't be read. */
export const REPORT_WINDOW_SECONDS = 3600

export const REPORT_THANKS = 'Thanks — we’ll take a look.'
export const REPORT_ALREADY = 'You’ve already reported this — thanks, we’ll take a look.'
export const REPORT_UNAVAILABLE = 'Reporting isn’t available yet.'

/** The door 214 adds, and the parameters this module sends it. */
export const REPORT_DOOR = { report_content: ['p_target_type', 'p_target_id', 'p_reason', 'p_note'] } as const

export interface ReportInput {
  targetType: ReportTargetType
  targetId: string
  reason?: ReportReason | null
  note?: string | null
}

export type ReportOutcome =
  /** A new report was written. */
  | { kind: 'reported'; reportId: string; message: string }
  /** This person had already reported this thing — nothing changed. */
  | { kind: 'already_reported'; reportId: string; message: string }
  /** Over 10 reports an hour: nothing written; try again after the wait. */
  | { kind: 'rate_limited'; retryAfterSeconds: number; message: string }
  /** 214 isn't on the database yet. */
  | { kind: 'unavailable'; message: string }
  /** The database said no, in plain words: signed out or your own thing
   *  (`not_allowed`), not there / not visible (`not_found`), or a bad reason,
   *  kind or note (`invalid`). */
  | { kind: 'refused'; reason: 'not_allowed' | 'not_found' | 'invalid'; message: string }
  /** Anything else — loud, with the database's message. */
  | { kind: 'error'; message: string }

type RpcError = PostgrestErrorShape & { hint?: string | null }

const REFUSAL_BY_CODE: Record<string, 'not_allowed' | 'not_found' | 'invalid'> = {
  '42501': 'not_allowed',
  P0002: 'not_found',
  '22023': 'invalid',
  '22001': 'invalid',
}

/** The RPC's answer (data or error) as an outcome. Pure. */
export function reportOutcome(data: unknown, error: RpcError | null | undefined): ReportOutcome {
  if (error) {
    const limit = parseRateLimitRefusal(error, REPORT_WINDOW_SECONDS)
    if (limit) {
      return {
        kind: 'rate_limited',
        retryAfterSeconds: limit.retryAfterSeconds,
        message: limit.serverMessage ?? reportRefusalCopy(limit.retryAfterSeconds),
      }
    }
    if (isDoorNotPushed({ code: error.code, message: error.message ?? '', hint: error.hint }, REPORT_DOOR)) {
      return { kind: 'unavailable', message: REPORT_UNAVAILABLE }
    }
    const refusal = REFUSAL_BY_CODE[error.code ?? '']
    const message = error.message?.trim() || 'Couldn’t send the report. Try again.'
    return refusal ? { kind: 'refused', reason: refusal, message } : { kind: 'error', message }
  }

  const answer = (data ?? null) as { status?: unknown; report_id?: unknown } | null
  const reportId = typeof answer?.report_id === 'string' ? answer.report_id : null
  if (answer?.status === 'reported' && reportId) return { kind: 'reported', reportId, message: REPORT_THANKS }
  if (answer?.status === 'already_reported' && reportId) {
    return { kind: 'already_reported', reportId, message: REPORT_ALREADY }
  }
  // An answer this module doesn't know is never shown as a success.
  return { kind: 'error', message: 'Couldn’t confirm the report was sent. Try again.' }
}

/** The limit's words when the database's own are missing. */
export function reportRefusalCopy(seconds: number): string {
  const wait =
    seconds < 60
      ? `${seconds} ${seconds === 1 ? 'second' : 'seconds'}`
      : `${Math.ceil(seconds / 60)} ${Math.ceil(seconds / 60) === 1 ? 'minute' : 'minutes'}`
  return `You’ve sent a lot of reports — you can report again in ${wait}.`
}

export interface ReportArgs {
  p_target_type: ReportTargetType
  p_target_id: string
  p_reason?: ReportReason
  p_note?: string
}

/** The RPC's arguments: a blank note is no note (the database agrees), and a
 *  missing reason or note is simply not sent (both default to none). */
export function reportArgs(input: ReportInput): ReportArgs {
  const note = input.note?.trim()
  return {
    p_target_type: input.targetType,
    p_target_id: input.targetId,
    ...(input.reason ? { p_reason: input.reason } : {}),
    ...(note ? { p_note: note } : {}),
  }
}

/** The minimal client surface this needs (any supabase-js client, or a fake in tests). */
export interface ReportRpcClient {
  rpc(fn: 'report_content', args: ReportArgs): PromiseLike<{ data: unknown; error: RpcError | null }>
}

/** Report something as the signed-in person the client holds. Never throws
 *  for a database answer — every one is an outcome. */
export async function reportContent(client: ReportRpcClient, input: ReportInput): Promise<ReportOutcome> {
  const { data, error } = await client.rpc('report_content', reportArgs(input))
  return reportOutcome(data, error)
}
