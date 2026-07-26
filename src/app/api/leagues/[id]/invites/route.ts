import { NextResponse } from 'next/server'
import { z } from 'zod'

import { createInvite } from '@/lib/leagues/api/invites-service'
import { createServerClient } from '@/lib/supabase/server'

interface RouteParams {
  params: Promise<{ id: string }>
}

const idSchema = z.uuid()

/** POST /api/leagues/[id]/invites — create a seat-targeted or general
 *  invite (commish; spec §15.1, §7.2 paths 2–4). Email invites go out
 *  through the D37 EmailSender seam (dev/log until a vendor is chosen). */
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
  const result = await createInvite(supabase, id, body)
  return NextResponse.json(result.body, { status: result.status })
}
