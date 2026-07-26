import { NextResponse } from 'next/server'
import { z } from 'zod'

import { revokeInvite } from '@/lib/leagues/api/invites-service'
import { createServerClient } from '@/lib/supabase/server'

interface RouteParams {
  params: Promise<{ id: string; iid: string }>
}

const idSchema = z.uuid()

/** DELETE /api/leagues/[id]/invites/[iid] — revoke an invite (commish;
 *  spec §15.1). Idempotent per D63. BOTH segments are validated and BOTH are
 *  passed down: the house pattern for doubly-nested routes constrains the
 *  parent (lists/[id]/comments/[commentId], lists/[id]/players/[playerId]/
 *  tier), so an invite that does not belong to [id] is refused rather than
 *  revoked (R86). */
export async function DELETE(_request: Request, { params }: RouteParams) {
  const { id, iid } = await params
  if (!idSchema.safeParse(id).success) {
    return NextResponse.json({ error: 'League not found' }, { status: 404 })
  }
  if (!idSchema.safeParse(iid).success) {
    return NextResponse.json({ error: 'Invite not found' }, { status: 404 })
  }

  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const result = await revokeInvite(supabase, id, iid)
  return NextResponse.json(result.body, { status: result.status })
}
