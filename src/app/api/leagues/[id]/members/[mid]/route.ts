import { NextResponse } from 'next/server'
import { z } from 'zod'

import { patchMember, removeMember } from '@/lib/leagues/api/members-service'
import { createServerClient } from '@/lib/supabase/server'

interface RouteParams {
  params: Promise<{ id: string; mid: string }>
}

const idSchema = z.uuid()

/** PATCH /api/leagues/[id]/members/[mid] — role change (commish; §15.1). The
 *  §15.1 autodraft toggle is deferred to M2 with the draft engine (F33) and
 *  gets an explicit named refusal in the service.
 *
 *  BOTH segments are validated and BOTH are passed down — the house pattern
 *  for doubly-nested routes constrains the parent, so a member id belonging
 *  to another league is refused rather than mutated (R86). */
export async function PATCH(request: Request, { params }: RouteParams) {
  const { id, mid } = await params
  if (!idSchema.safeParse(id).success) {
    return NextResponse.json({ error: 'League not found' }, { status: 404 })
  }
  if (!idSchema.safeParse(mid).success) {
    return NextResponse.json({ error: 'Member not found' }, { status: 404 })
  }

  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json().catch(() => null)
  const result = await patchMember(supabase, id, mid, body)
  return NextResponse.json(result.body, { status: result.status })
}

/** DELETE /api/leagues/[id]/members/[mid] — remove a manager, body
 *  { mode, successor_user_id?, reason } (§15.1; §7.2.1 outcomes). §15.1
 *  prints no leave endpoint, so this same verb serves the voluntary leave:
 *  the service dispatches on whose membership [mid] is (D74(8)). */
export async function DELETE(request: Request, { params }: RouteParams) {
  const { id, mid } = await params
  if (!idSchema.safeParse(id).success) {
    return NextResponse.json({ error: 'League not found' }, { status: 404 })
  }
  if (!idSchema.safeParse(mid).success) {
    return NextResponse.json({ error: 'Member not found' }, { status: 404 })
  }

  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json().catch(() => null)
  const result = await removeMember(supabase, id, mid, user.id, body)
  return NextResponse.json(result.body, { status: result.status })
}
