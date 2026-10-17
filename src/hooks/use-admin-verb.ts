import { useMutation, useQueryClient } from '@tanstack/react-query'

import type { OpVerbResult } from '@/components/admin/admin-console-ops'
import { adminFetch, adminKeys } from '@/lib/admin/admin-api'

export interface AdminVerbCall {
  url: string
  body: Record<string, unknown>
}

/**
 * One operator action (job knob, game mark, notice). The caller supplies the
 * `action_id` in `body` — made when its confirm dialog / compose opened, and
 * reused if it retries — so a double click or a retry never acts twice (TD3).
 * Every admin read is refetched after, so the page shows the new state.
 */
export function useAdminVerb() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ url, body }: AdminVerbCall) => adminFetch<OpVerbResult>(url, { method: 'POST', body }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: adminKeys.all }),
  })
}
