import { useMutation, useQueryClient } from '@tanstack/react-query'

import { adminFetch, adminKeys } from '@/lib/admin/admin-api'

export type AdminReportAction = 'review' | 'remove'

export interface AdminReportActionAnswer {
  status: 'reviewed' | 'already_reviewed' | 'removed'
  /** Remove: who the database removed it as (`operator` stamps the reports). */
  removed_as?: string
  /** Remove: how many open reports on the comment it marked reviewed. */
  reports_reviewed?: number
}

/**
 * Admin › Reports' Mark reviewed and Remove (Community launch plan C10) —
 * `POST /api/admin/reports/[id]`. The reports (and Home's count) are read
 * again after, whatever the answer, so the page shows the database's state.
 */
export function useAdminReportAction() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ reportId, action }: { reportId: string; action: AdminReportAction }) =>
      adminFetch<AdminReportActionAnswer>(`/api/admin/reports/${encodeURIComponent(reportId)}`, {
        method: 'POST',
        body: { action },
      }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: adminKeys.reports() }),
  })
}
