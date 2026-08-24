import { NextResponse } from 'next/server'

import { placeBid, standaloneMockScope } from '@/lib/leagues/api/draft-service'
import { createServerClient } from '@/lib/supabase/server'

interface RouteParams {
  params: Promise<{ mockId: string }>
}

/**
 * POST /api/mocks/[mockId]/bid — bid in a STANDALONE practice auction
 * (MP.6b; §8.6/§8.8). Thin wrapper over the same `placeBid` the league
 * route calls; see `…/pick/route.ts` for the URL decision.
 *
 * F64 is unweakened here: the nomination identity (`nomination_seq` +
 * `player_id`) rides every call, so a bid in flight across a nomination
 * boundary gets the RPC's "just went off the board" copy as a friendly 400
 * rather than landing on whatever player is live.
 *
 * NO feature-flag read (§4 rule 13 / D231(4)).
 */
export async function POST(request: Request, { params }: RouteParams) {
  const { mockId } = await params

  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json().catch(() => null)
  const result = await placeBid(supabase, standaloneMockScope(mockId, user.id), user.id, body)
  return NextResponse.json(result.body, { status: result.status })
}
