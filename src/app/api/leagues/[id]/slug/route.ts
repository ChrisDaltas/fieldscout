import { NextResponse } from 'next/server'
import { z } from 'zod'

import { setInviteSlug } from '@/lib/leagues/api/invites-service'
import { createServerClient } from '@/lib/supabase/server'

interface RouteParams {
  params: Promise<{ id: string }>
}

const idSchema = z.uuid()

/** PATCH /api/leagues/[id]/slug — set/clear the custom invite slug
 *  (commish; spec §15.1, §7.2 path 1). Body: { invite_slug: string|null }. */
export async function PATCH(request: Request, { params }: RouteParams) {
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
  const result = await setInviteSlug(supabase, id, body)
  return NextResponse.json(result.body, { status: result.status })
}
