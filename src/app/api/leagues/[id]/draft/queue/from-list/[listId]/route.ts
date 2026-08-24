import { NextResponse } from 'next/server'
import { z } from 'zod'

import { leagueScope, queueFromList } from '@/lib/leagues/api/draft-service'
import { createServerClient } from '@/lib/supabase/server'

interface RouteParams {
  params: Promise<{ id: string; listId: string }>
}

const idSchema = z.uuid()

/**
 * POST /api/leagues/[id]/draft/queue/from-list/[listId] — §8.9/§15.5
 * "load into queue" (L.B2.2): the attached list in list order, already-
 * drafted players skipped, `mode: replace` (default) or `append` ("Add
 * remaining"). The list must be attached to THIS league and visible to the
 * caller (own attachment or league-shared — 067's RLS scope).
 */
export async function POST(request: Request, { params }: RouteParams) {
  const { id, listId } = await params
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

  // An empty body is legal (mode defaults to replace).
  const body = await request.json().catch(() => null)
  const result = await queueFromList(supabase, leagueScope(id), user.id, listId, body ?? {})
  return NextResponse.json(result.body, { status: result.status })
}
