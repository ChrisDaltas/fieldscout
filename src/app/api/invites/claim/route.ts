import { NextResponse } from 'next/server'

import { claimInvite } from '@/lib/leagues/api/invites-service'
import { createServerClient } from '@/lib/supabase/server'

/** POST /api/invites/claim — claim by token (spec §15.1; §7.2 claim flow;
 *  E53/E54/E65 outcomes surface in the body per D72). The PRE-AUTH preview
 *  is not a route: /join/[token] calls the get_join_preview RPC directly
 *  over the anon key (the documented §4.1 carve-out). */
export async function POST(request: Request) {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json().catch(() => null)
  const result = await claimInvite(supabase, body)
  return NextResponse.json(result.body, { status: result.status })
}
