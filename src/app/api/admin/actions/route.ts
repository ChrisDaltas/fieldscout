import { NextResponse } from 'next/server'

import { requireAdminUser } from '@/lib/auth/require-admin'

/**
 * GET /api/admin/actions — the operator log: the newest
 * `platform_operator_actions` receipts (M8 L.G1.6; spec §24.4 "Audit";
 * migration 182). The admin gate (404 to everyone else — TD8), then a plain
 * select through the operator's OWN session client: 182's one SELECT policy
 * lets operators read the table, nobody else, and nobody can write it.
 *
 * Overflow is stated, never hidden: the answer carries `total` (an exact
 * count) beside the newest `limit` rows, so "showing 50 of 312" is honest and
 * a PostgREST cap can never pass for the whole log.
 */
const OPERATOR_LOG_LIMIT = 50

export async function GET() {
  const gate = await requireAdminUser()
  if (!gate.ok) return gate.response

  const { data, error, count } = await gate.supabase
    .from('platform_operator_actions')
    .select('id, action_id, verb, scope, league_id, reason, before, after, created_at', { count: 'exact' })
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(OPERATOR_LOG_LIMIT)

  if (error) {
    if (error.code === '42P01' || error.code === 'PGRST205') {
      return NextResponse.json({ error: 'The operator log is not available yet.' }, { status: 503 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  // Fail loud: a missing list or count is never rendered as "no actions yet".
  if (!Array.isArray(data) || typeof count !== 'number') {
    return NextResponse.json({ error: 'The operator log returned nothing.' }, { status: 500 })
  }
  return NextResponse.json({ actions: data, total: count, limit: OPERATOR_LOG_LIMIT }, { status: 200 })
}
