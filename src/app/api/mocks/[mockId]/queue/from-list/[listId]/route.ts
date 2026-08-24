import { NextResponse } from 'next/server'

import { queueFromList, standaloneMockScope } from '@/lib/leagues/api/draft-service'
import { createServerClient } from '@/lib/supabase/server'

interface RouteParams {
  params: Promise<{ mockId: string; listId: string }>
}

/**
 * POST /api/mocks/[mockId]/queue/from-list/[listId] — §8.9 "load into
 * queue", standalone edition (MP.6b).
 *
 * ONE difference from the league sibling, and it is in the service, stated
 * there: §8.9 scopes loadable lists by the LEAGUE TAG, and a practice draft
 * has no league to tag one to — so the standalone arm scopes by OWNERSHIP
 * (the caller's own list), which is the predicate §8.8 v2.16 names for
 * standalone practice. Deliberately narrower than the league arm: a public
 * list somebody else owns is readable and is still refused here.
 *
 * NO feature-flag read (§4 rule 13 / D231(4)).
 */
export async function POST(request: Request, { params }: RouteParams) {
  const { mockId, listId } = await params

  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // An empty body is legal (mode defaults to replace).
  const body = await request.json().catch(() => null)
  const result = await queueFromList(
    supabase,
    standaloneMockScope(mockId, user.id),
    user.id,
    listId,
    body ?? {},
  )
  return NextResponse.json(result.body, { status: result.status })
}
