import { NextResponse } from 'next/server'
import { z } from 'zod'

import { leagueScope, nominatePlayer } from '@/lib/leagues/api/draft-service'
import { createServerClient } from '@/lib/supabase/server'

interface RouteParams {
  params: Promise<{ id: string }>
}

const idSchema = z.uuid()

/**
 * POST /api/leagues/[id]/draft/nominate — auction nomination (§15.2/§8.6.2;
 * M3 task L.C2.1). Thin wrapper over `draft_nominate` (085/089) via the
 * service: the body carries `player_id`, `opening_bid` and the hook-minted
 * `action_id` (D68(1) — one UUID per user submit, minted by THIS verb's
 * hook and never shared with a bid — F65; a retry replays as E2). Turn,
 * phase, availability, the §8.6.7(a) opening-bid ceiling and the mock
 * launcher gate (D103(2)/D138) are the RPC's under the §4.6 lock; every
 * refusal is product copy passed through as a 400. Optional `draft_id`
 * (a mock room sends its own — D113(2)).
 *
 * The signed-in user's id rides into the service (R420): the F65 response-
 * integrity check compares the row the RPC hands back to the CALLER'S ACTING
 * SEAT, which is the one fact a member replaying another manager's readable
 * `draft_bids` row cannot supply.
 */
export async function POST(request: Request, { params }: RouteParams) {
  const { id } = await params
  if (!idSchema.safeParse(id).success) {
    return NextResponse.json({ error: 'League not found' }, { status: 404 })
  }

  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json().catch(() => null)
  const result = await nominatePlayer(supabase, leagueScope(id), user.id, body)
  return NextResponse.json(result.body, { status: result.status })
}
