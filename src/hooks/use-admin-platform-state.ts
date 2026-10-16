import { useQuery } from '@tanstack/react-query'

import type { OpPlatformState } from '@/components/admin/admin-console-ops'
import { adminFetch, adminKeys } from '@/lib/admin/admin-api'

/** GET /api/admin/state — the platform view (186 `op_platform_state`). */
export function useAdminPlatformState() {
  return useQuery({
    queryKey: adminKeys.platform(),
    queryFn: () => adminFetch<OpPlatformState>('/api/admin/state'),
    refetchInterval: 60_000,
  })
}
