import { NextResponse } from 'next/server'
import { z } from 'zod'

import { previewRemix } from '@/lib/leagues/api/schedule-service'
import { createServerClient } from '@/lib/supabase/server'

interface RouteParams {
  params: Promise<{ id: string }>
}

const idSchema = z.uuid()

/** POST /api/leagues/[id]/schedule/remix — regenerate the schedule with a new
 *  seed and return the PREVIEW (§15.3, §11.7 → `schedule_preview`, migration
 *  111). Write-free: 111 runs the same generator without writing.
 *
 *  Body: { seed } — and nothing else. The strict schema in
 *  `schedule-service.ts` is what refuses a client-supplied schedule; see its
 *  header for why that is the law this pair of routes exists to keep. */
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
  const result = await previewRemix(supabase, id, body)
  return NextResponse.json(result.body, { status: result.status })
}
