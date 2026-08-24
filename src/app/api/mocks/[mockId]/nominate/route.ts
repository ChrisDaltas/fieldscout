import { NextResponse } from 'next/server'

import { nominatePlayer, standaloneMockScope } from '@/lib/leagues/api/draft-service'
import { createServerClient } from '@/lib/supabase/server'

interface RouteParams {
  params: Promise<{ mockId: string }>
}

/**
 * POST /api/mocks/[mockId]/nominate — nominate in a STANDALONE practice
 * auction (MP.6b; §8.6/§8.8). The league sibling's twin, differing in the
 * scope argument and nothing else — see `…/pick/route.ts` for why the URL
 * has this shape and why there is no second service path behind it.
 *
 * F64/F65 ride unchanged: `player_id` + `opening_bid` + `action_id` are all
 * required wire-side, and the response-integrity check still discriminates
 * on the acting seat, which on a mock is the LAUNCHER's human seat
 * (`resolveActingSeat`'s shipped mock arm, D103(3)).
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
  const result = await nominatePlayer(
    supabase,
    standaloneMockScope(mockId, user.id),
    user.id,
    body,
  )
  return NextResponse.json(result.body, { status: result.status })
}
