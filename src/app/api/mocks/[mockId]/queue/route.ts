import { NextResponse } from 'next/server'

import { standaloneMockScope, upsertQueue } from '@/lib/leagues/api/draft-service'
import { createServerClient } from '@/lib/supabase/server'

interface RouteParams {
  params: Promise<{ mockId: string }>
}

/**
 * POST /api/mocks/[mockId]/queue — whole-queue upsert/reorder in a
 * STANDALONE practice draft (§8.4; MP.6b). Thin wrapper over the same
 * `upsertQueue`; see `…/pick/route.ts` for the URL decision.
 *
 * The seat written is the LAUNCHER's human seat (`resolveActingSeat`'s mock
 * arm), and the 065 "Own queue write" policy stays the RLS backstop — on a
 * standalone mock its `league_id IS NULL` arm from 095.
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
  const result = await upsertQueue(supabase, standaloneMockScope(mockId, user.id), user.id, body)
  return NextResponse.json(result.body, { status: result.status })
}
