import { NextResponse } from 'next/server'
import { z } from 'zod'

import { attachLeagueList, listLeagueLists } from '@/lib/leagues/api/league-lists-service'
import { createServerClient } from '@/lib/supabase/server'

interface RouteParams {
  params: Promise<{ id: string }>
}

const idSchema = z.uuid()

/** GET /api/leagues/[id]/lists — my attached lists (+ league-shared)
 *  (spec §15.5; M2 task L.B4.1). Thin handler over the RLS-scoped SELECT. */
export async function GET(_request: Request, { params }: RouteParams) {
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

  const result = await listLeagueLists(supabase, id, user.id)
  return NextResponse.json(result.body, { status: result.status })
}

/** POST /api/leagues/[id]/lists — attach one of my lists to this league
 *  (spec §7.4/§15.5). Friendly 4xxs over the RLS-writable table — 067's
 *  policies + the D106 composite FK are the enforcement backstop. */
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
  const result = await attachLeagueList(supabase, id, user.id, body)
  return NextResponse.json(result.body, { status: result.status })
}
