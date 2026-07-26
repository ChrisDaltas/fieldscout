import { NextResponse } from 'next/server'
import { z } from 'zod'

import { rotateInviteCode } from '@/lib/leagues/api/invites-service'
import { createServerClient } from '@/lib/supabase/server'

interface RouteParams {
  params: Promise<{ id: string }>
}

const idSchema = z.uuid()

/** POST /api/leagues/[id]/invite — rotate/refresh the league share code
 *  (commish; spec §15.1, §7.2 "rotatable", §22.5). The custom slug is
 *  untouched — that's PATCH /api/leagues/[id]/slug. */
export async function POST(_request: Request, { params }: RouteParams) {
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

  const result = await rotateInviteCode(supabase, id)
  return NextResponse.json(result.body, { status: result.status })
}
