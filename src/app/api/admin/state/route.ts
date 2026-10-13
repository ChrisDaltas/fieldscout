import { requireAdminUser } from '@/lib/auth/require-admin'
import { opReadResponse } from '@/lib/admin/op-read-response'

/**
 * GET /api/admin/state — the platform view across every league (M8 L.G1.5;
 * spec §24.4; migration 186): open pauses, held / marked games, pending
 * totals, the last run and status of every scheduled job. Operator's own
 * session client; the RPC re-checks the gate in-body.
 */
export async function GET() {
  const gate = await requireAdminUser()
  if (!gate.ok) return gate.response

  const { data, error } = await gate.supabase.rpc('op_platform_state')
  return opReadResponse(data, error)
}
