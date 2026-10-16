import { useQuery } from '@tanstack/react-query'

import type { OpLogRow } from '@/components/admin/admin-console-ops'
import { adminFetch, adminKeys } from '@/lib/admin/admin-api'

export interface OperatorLogPage {
  actions: OpLogRow[]
  total: number
  limit: number
}

/** GET /api/admin/actions — the newest operator receipts plus the exact total. */
export function useAdminOperatorLog() {
  return useQuery({
    queryKey: adminKeys.log(),
    queryFn: () => adminFetch<OperatorLogPage>('/api/admin/actions'),
  })
}
