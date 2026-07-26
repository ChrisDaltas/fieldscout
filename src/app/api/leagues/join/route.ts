import { NextResponse } from 'next/server'

import { joinLeague } from '@/lib/leagues/api/invites-service'
import { createServerClient } from '@/lib/supabase/server'

/** POST /api/leagues/join — join via invite code or custom slug (spec
 *  §15.1; §7.2 "Join with invite code (free)" — Q6/v2.8: NO Pro gate, F5).
 *  Body: { code: string }. Outcomes per D72 (reason/message in the body). */
export async function POST(request: Request) {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json().catch(() => null)
  const result = await joinLeague(supabase, body)
  return NextResponse.json(result.body, { status: result.status })
}
