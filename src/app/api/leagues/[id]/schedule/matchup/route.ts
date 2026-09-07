import { NextResponse } from 'next/server'
import { z } from 'zod'

import { editMatchup } from '@/lib/leagues/api/schedule-service'
import { createServerClient } from '@/lib/supabase/server'

interface RouteParams {
  params: Promise<{ id: string }>
}

const idSchema = z.uuid()

/** POST /api/leagues/[id]/schedule/matchup — the commissioner's manual
 *  matchup edit (§11.7 "drag Team A ↔ Team C for Week 7" → 111's
 *  `schedule_edit_matchup`; M4 task L.D5.3, PROGRESS F233(e)). Atomic, with
 *  the D97 system chat post written in the same transaction; E41's reason
 *  law evaluated in-body at transaction time.
 *
 *  Body: { matchup_id, home_team_id, away_team_id, reason?, action_id } —
 *  and nothing else (the strict schema in `schedule-service.ts`). One
 *  matchup's two teams, never a schedule. */
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
  const result = await editMatchup(supabase, id, body)
  return NextResponse.json(result.body, { status: result.status })
}
