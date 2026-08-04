import { NextResponse } from 'next/server'
import { z } from 'zod'

import { detachLeagueList, patchLeagueList } from '@/lib/leagues/api/league-lists-service'
import { createServerClient } from '@/lib/supabase/server'

interface RouteParams {
  params: Promise<{ id: string; llid: string }>
}

const idSchema = z.uuid()

/** PATCH /api/leagues/[id]/lists/[llid] — set primary board / toggle shared
 *  (spec §7.4/§15.5; M2 task L.B4.1). BOTH segments constrain the write
 *  (the R86 doubly-nested-route rule). */
export async function PATCH(request: Request, { params }: RouteParams) {
  const { id, llid } = await params
  if (!idSchema.safeParse(id).success) {
    return NextResponse.json({ error: 'League not found' }, { status: 404 })
  }
  if (!idSchema.safeParse(llid).success) {
    return NextResponse.json({ error: 'Attachment not found' }, { status: 404 })
  }

  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json().catch(() => null)
  const result = await patchLeagueList(supabase, id, llid, user.id, body)
  return NextResponse.json(result.body, { status: result.status })
}

/** DELETE /api/leagues/[id]/lists/[llid] — detach (spec §7.4/§15.5).
 *  Non-destructive: removes only the association, never the list. */
export async function DELETE(_request: Request, { params }: RouteParams) {
  const { id, llid } = await params
  if (!idSchema.safeParse(id).success) {
    return NextResponse.json({ error: 'League not found' }, { status: 404 })
  }
  if (!idSchema.safeParse(llid).success) {
    return NextResponse.json({ error: 'Attachment not found' }, { status: 404 })
  }

  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const result = await detachLeagueList(supabase, id, llid)
  return NextResponse.json(result.body, { status: result.status })
}
