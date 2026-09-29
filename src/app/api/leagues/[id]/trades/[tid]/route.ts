import { NextResponse } from 'next/server'
import { z } from 'zod'

import { actOnTrade } from '@/lib/leagues/api/trades-service'
import { createServerClient } from '@/lib/supabase/server'

interface RouteParams {
  params: Promise<{ id: string; tid: string }>
}

const idSchema = z.uuid()

/** PATCH /api/leagues/[id]/trades/[tid] — answer or vote on one trade
 *  (§15.3 "accept/reject/cancel/vote"; M5 L.D3.6). Told apart by `op`:
 *   - { op: 'accept', drops?, action_id, reason? } — the receiving team,
 *     naming the drops its roster needs (E36) → `trade_respond` (151);
 *   - { op: 'reject' | 'cancel', action_id, reason? } — reject is the
 *     receiving team's, cancel the proposing team's;
 *   - { op: 'counter', items, drops?, note?, action_id, reason? } — the
 *     receiving team: the offer is rejected and a new one goes the other way;
 *   - { op: 'vote', vote: 'veto' | 'approve', action_id } — a league-vote
 *     review (Q77) → `trade_vote` (155); the caller votes for his own team.
 *  A commissioner may make either side's respond move (TD5); `reason` is
 *  stored only on that arm. Thin: the schema, the RPC, the mapping and the
 *  F65(b) guard are `trades-service.ts`'s. */
export async function PATCH(request: Request, { params }: RouteParams): Promise<NextResponse> {
  const { id, tid } = await params
  if (!idSchema.safeParse(id).success) {
    return NextResponse.json({ error: 'League not found' }, { status: 404 })
  }
  if (!idSchema.safeParse(tid).success) {
    return NextResponse.json({ error: 'Trade not found' }, { status: 404 })
  }

  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json().catch(() => null)
  const result = await actOnTrade(supabase, id, tid, body)
  return NextResponse.json(result.body, { status: result.status })
}
