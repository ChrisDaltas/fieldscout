'use client'

import { useAuth } from '@/hooks/use-auth'
import { useReportContent } from '@/hooks/use-report-content'
import { toast } from '@/hooks/use-toast'
import { REPORT_NOT_SENT, settleReport, type ReportableType } from '@/components/report/report-ops'
import type { ReportReason } from '@/lib/community/report-content'
import { reportKey, useReportedStore } from '@/stores/reported-store'

/**
 * One Report form's controller (Community launch plan C10) — the phone sheet
 * and the desktop dialog share it. `send` calls C9's `report_content`
 * (through `useReportContent`) and shows its answer as it is
 * (`settleReport` → `reportResult`): the thanks line, "already reported", "Reporting isn't
 * available yet" before migration 214 is pushed, the hourly limit's wait, or
 * the database's refusal. `reported` is true once the database has answered
 * reported / already reported this session (`reported-store`).
 */
export function useReport(target: { type: ReportableType; id: string }) {
  const { user } = useAuth()
  const mutation = useReportContent()
  const key = user ? reportKey(user.id, target.type, target.id) : null
  const reported = useReportedStore((state) => (key ? state.reported[key] === true : false))
  const markReported = useReportedStore((state) => state.markReported)

  const send = (input: { reason: ReportReason | null; note: string }, onClose: () => void) => {
    // One report at a time: a second tap mid-flight is the same report.
    if (mutation.isPending) return
    mutation.mutate(
      { targetType: target.type, targetId: target.id, reason: input.reason, note: input.note },
      {
        onSuccess: (outcome) =>
          settleReport(outcome, {
            markReported: () => {
              if (key) markReported(key)
            },
            notify: (spec) => toast(spec),
            close: onClose,
          }),
        // Only an unexpected failure rejects (`useReportContent`): loud, and
        // the form stays open with the note still in it.
        onError: (error) => toast({ title: REPORT_NOT_SENT, description: error.message, variant: 'destructive' }),
      },
    )
  }

  return { reported, send, sending: mutation.isPending }
}
