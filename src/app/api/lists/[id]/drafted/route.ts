/**
 * /api/lists/[id]/drafted — the ONE new API route in the Lists v2 build
 * (delivery plan v3.3 §3 **D6**(a), task **LV.1.2**, design decision **D2**).
 *
 * Thin wrappers only: everything decidable lives in
 * `src/lib/lists/drafted-service.ts` so the stack suite can drive it with real
 * signed-in clients. Migration 079's RLS is the enforcement backstop — this
 * file authenticates and delegates, nothing else.
 *
 *   GET    → { list_id, drafted: string[] }        my marks on this list
 *   POST   → { player_id, drafted: boolean }       set one player's state
 *   DELETE → { list_id, cleared: number }          LV.3.9's "Clear drafted"
 */
import { NextResponse } from 'next/server'

import { clearDrafted, listDrafted, setDrafted } from '@/lib/lists/drafted-service'
import { createServerClient } from '@/lib/supabase/server'

interface RouteParams {
  params: Promise<{ id: string }>
}

export async function GET(_request: Request, { params }: RouteParams) {
  const { id } = await params
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const result = await listDrafted(supabase, id, user.id)
  return NextResponse.json(result.body, { status: result.status })
}

export async function POST(request: Request, { params }: RouteParams) {
  const { id } = await params
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json().catch(() => null)
  const result = await setDrafted(supabase, id, user.id, body)
  return NextResponse.json(result.body, { status: result.status })
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const { id } = await params
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const result = await clearDrafted(supabase, id, user.id)
  return NextResponse.json(result.body, { status: result.status })
}
