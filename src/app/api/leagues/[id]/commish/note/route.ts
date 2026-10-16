import { NextResponse } from 'next/server'
import { z } from 'zod'

import { readLeagueNote, setLeagueNote } from '@/lib/leagues/api/league-note-service'
import { createServerClient } from '@/lib/supabase/server'

interface RouteParams {
  params: Promise<{ id: string }>
}

const idSchema = z.uuid()

/** The commissioner note (gap list #13; migration 192).
 *
 *  GET  — any MEMBER reads the league's note: `{ available, note }` (the
 *         commissioner log's precedent — a `commish/` read any member may
 *         make). `available: false` = the database predates 192.
 *  POST — `{ note, reason? }`: the commissioner or a co-commissioner sets
 *         it; an empty note clears it. Authorization is the RPC's (one
 *         no-leak 42501 → 403); this handler does not pre-check the role.
 *
 *  Thin per the D68/D71 layering: auth + param plumbing only; everything
 *  else is `league-note-service.ts`. */
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

  const result = await readLeagueNote(supabase, id)
  return NextResponse.json(result.body, { status: result.status })
}

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
  const result = await setLeagueNote(supabase, id, body)
  return NextResponse.json(result.body, { status: result.status })
}
