import { useQuery } from '@tanstack/react-query'

import { AdminApiError, adminFetch, adminKeys } from '@/lib/admin/admin-api'
import type { AdminReportsPayload } from '@/lib/admin/content-reports'

/**
 * GET /api/admin/reports — Admin › Reports, and the "N new reports" line on
 * Admin home (Community launch plan C10). A 503 (migration 214 not pushed
 * yet) rejects with `AdminApiError` status 503 — the page says reports aren't
 * available yet; any other failure is loud. `enabled` is false while the
 * Community switch is off.
 */
export function useAdminReports({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: adminKeys.reports(),
    queryFn: () => adminFetch<AdminReportsPayload>('/api/admin/reports'),
    enabled,
    refetchInterval: 60_000,
    // A 503 is an answer, not a blip: don't hammer a door that isn't there.
    retry: (count, error) => !(error instanceof AdminApiError && error.status === 503) && count < 2,
  })
}
