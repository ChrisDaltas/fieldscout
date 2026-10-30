import { create } from 'zustand'

import type { ReportTargetType } from '@/lib/community/report-content'

/**
 * What you've reported this session (Community launch plan C10): a Report
 * control shows "Reported" once the database has answered `reported` or
 * `already_reported` for that thing.
 *
 * In memory only, on purpose. The database keeps reports where no browser
 * can read them — `content_reports` has RLS on and no client policy
 * (migration 214: "a report is never readable by anyone it is about, nor by
 * the reporter's browser") — so after a reload the control shows Report
 * again. Reporting the same thing again is harmless: the database answers
 * "already reported", writes nothing and spends nothing, and the control
 * goes back to Reported. A stored copy here would be a claim the database
 * can't back.
 *
 * Keyed by the signed-in person too, so someone else signing in on the same
 * tab never inherits your Reported marks.
 */
export function reportKey(userId: string, type: ReportTargetType, targetId: string): string {
  return `${userId}:${type}:${targetId}`
}

interface ReportedStore {
  reported: Record<string, true>
  markReported: (key: string) => void
}

export const useReportedStore = create<ReportedStore>((set) => ({
  reported: {},
  markReported: (key) => set((state) => (state.reported[key] ? state : { reported: { ...state.reported, [key]: true } })),
}))

/** Whether `userId` has reported this thing this session. Pure over a snapshot. */
export function wasReported(
  reported: Record<string, true>,
  userId: string | null | undefined,
  type: ReportTargetType,
  targetId: string,
): boolean {
  return Boolean(userId) && reported[reportKey(userId as string, type, targetId)] === true
}
