import { NextResponse } from 'next/server'
import { z } from 'zod'

import { placeBid } from '@/lib/leagues/api/draft-service'
import { createServerClient } from '@/lib/supabase/server'

interface RouteParams {
  params: Promise<{ id: string }>
}

const idSchema = z.uuid()

/**
 * POST /api/leagues/[id]/draft/bid — auction bid (§15.2/§8.6.3; M3 task
 * L.C2.1). Thin wrapper over `draft_place_bid` (085/089) via the service:
 * the body carries `amount`, the NOMINATION IDENTITY the room is looking at
 * (`nomination_seq` + `player_id` — REQUIRED, F64: a bid in flight across a
 * nomination boundary must be refused, never applied to whatever player is
 * live when it executes) and the hook-minted `action_id` (D68(1) — one UUID
 * per submit, minted by THIS verb's hook and never a nomination's — F65).
 * Phase, franchise, the integer-raise floor, the E5 max-bid ceiling, the
 * anti-snipe floor and the mock launcher gate are the RPC's under the §4.6
 * lock; the instant "outbid" loser and "just went off the board" are
 * friendly 400s (D136 — never a 429). Optional `draft_id` (D113(2)).
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
  const result = await placeBid(supabase, id, user.id, body)
  return NextResponse.json(result.body, { status: result.status })
}
