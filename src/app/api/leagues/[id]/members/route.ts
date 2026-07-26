import { NextResponse } from 'next/server'
import { z } from 'zod'

import { addPlaceholderSeat } from '@/lib/leagues/api/members-service'
import { createServerClient } from '@/lib/supabase/server'

interface RouteParams {
  params: Promise<{ id: string }>
}

const idSchema = z.uuid()

/** POST /api/leagues/[id]/members — add a placeholder seat (commish; §15.1,
 *  §7.2 "Commissioner can create empty seats"). */
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
  const result = await addPlaceholderSeat(supabase, id, body)
  return NextResponse.json(result.body, { status: result.status })
}
