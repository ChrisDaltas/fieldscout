import {
  REPORT_THANKS,
  REPORT_UNAVAILABLE,
  type ReportOutcome,
  type ReportTargetType,
} from '@/lib/community/report-content'
import { featureFlags } from '@/lib/feature-flags'

/**
 * Report — the button and its form (Community launch plan C10, readiness
 * S3), on top of C9's `report_content` (migration 214) and its client door
 * (`@/lib/community/report-content`, `useReportContent`).
 *
 * Report rides the Community switch: while `community` is off nothing here
 * shows anywhere, and every screen it touches is as it was.
 *
 * Who sees it (prevent, don't refuse — the database's "You can't report your
 * own …" is only the backstop):
 *  - nobody, on their own list or comment (`hidden`);
 *  - signed out, it is there and sends you to sign in (`sign-in`);
 *  - everyone else gets Report (`report`).
 *
 * Start/sit questions are reportable in the database (C9) but get no Report
 * button in this run — the Ask plan adds it with its own cards.
 */
export function reportControlsOn(): boolean {
  return featureFlags.community
}

export type ReportAccess = 'hidden' | 'sign-in' | 'report'

export function reportAccess({
  viewerId,
  ownerId,
}: {
  /** The signed-in viewer, or none when signed out. */
  viewerId: string | null | undefined
  /** Who wrote the comment / owns the list (unknown: still offered — the
   *  database re-checks). */
  ownerId: string | null | undefined
}): ReportAccess {
  if (!reportControlsOn()) return 'hidden'
  if (!viewerId) return 'sign-in'
  if (ownerId && ownerId === viewerId) return 'hidden'
  return 'report'
}

/** The things this run puts a Report button on. */
export type ReportableType = Extract<ReportTargetType, 'list' | 'comment'>

export const REPORT_COPY: Record<ReportableType, { item: string; title: string }> = {
  list: { item: 'Report list', title: 'Report this list' },
  comment: { item: 'Report comment', title: 'Report this comment' },
}

/** What the control says once you've reported the thing. */
export const REPORTED_LABEL = 'Reported'
/** The form's one line of help, on both layouts. */
export const REPORT_HELP = 'Only FieldScout sees reports. Picking a reason is optional.'
export const REPORT_REASON_LABEL = 'Reason (optional)'
export const REPORT_NOTE_PLACEHOLDER = 'Add a note (optional)'
export const REPORT_SEND = 'Send report'
export const REPORT_SENDING = 'Sending…'
export const REPORT_CANCEL = 'Cancel'
export const REPORT_NOT_SENT = 'That report wasn’t sent'

export interface ReportToast {
  title: string
  description?: string
  /**
   * Never left to the default: on desktop the default toast leads with the
   * green success check, which only a report that went through may wear
   * (`reported` / `already_reported`). A wait or a not-yet is `caution` (the
   * amber info mark on the same ink toast, not the error glyph); a refusal or
   * a failure is `destructive`.
   */
  variant?: 'destructive' | 'caution'
}

export interface ReportResult {
  toast: ReportToast
  /** The control now shows "Reported". */
  reported: boolean
  /** The form closes (otherwise it stays open with the note still typed). */
  close: boolean
}

/**
 * What the viewer sees for each of the database's answers. Pure.
 *  - a new report: "Thanks — we'll take a look.", then Reported;
 *  - already reported: says so, then Reported — no second report;
 *  - before 214 is pushed: "Reporting isn't available yet." — never a
 *    pretend thanks (nor the success check), and the control stays Report;
 *  - over the hourly limit: the database's own reason in the normal ink
 *    toast with the amber caution mark, and the form stays open so the note
 *    isn't lost;
 *  - refused (gone, or your own after all): the database's words, the form
 *    closes; a bad note keeps it open.
 */
export function reportResult(outcome: ReportOutcome): ReportResult {
  switch (outcome.kind) {
    case 'reported':
      return { toast: { title: REPORT_THANKS }, reported: true, close: true }
    case 'already_reported':
      return { toast: { title: outcome.message }, reported: true, close: true }
    case 'unavailable':
      return { toast: { title: REPORT_UNAVAILABLE, variant: 'caution' }, reported: false, close: true }
    case 'rate_limited':
      return {
        toast: { title: REPORT_NOT_SENT, description: outcome.message, variant: 'caution' },
        reported: false,
        close: false,
      }
    case 'refused':
      return {
        toast: { title: REPORT_NOT_SENT, description: outcome.message, variant: 'destructive' },
        reported: false,
        close: outcome.reason !== 'invalid',
      }
    case 'error':
      return {
        toast: { title: REPORT_NOT_SENT, description: outcome.message, variant: 'destructive' },
        reported: false,
        close: false,
      }
  }
}

/**
 * Apply one answer: mark the thing reported (when it is), show the toast,
 * close the form (when it should). The one place both layouts' forms settle
 * a report — `useReport` calls it with the store, the toast and the form's
 * close.
 */
export function settleReport(
  outcome: ReportOutcome,
  effects: { markReported: () => void; notify: (toast: ReportToast) => void; close: () => void },
): ReportResult {
  const result = reportResult(outcome)
  if (result.reported) effects.markReported()
  effects.notify(result.toast)
  if (result.close) effects.close()
  return result
}

/** "120 / 500" under the note. */
export function noteCounter(note: string, max: number): string {
  return `${note.length} / ${max}`
}
