import { NextResponse } from 'next/server'
import { z } from 'zod'

import { createServerClient } from '@/lib/supabase/server'

const bodySchema = z.object({
  tier: z.enum(['S', 'A', 'B', 'C', 'D', 'F']).nullable(),
})

interface RouteParams {
  params: Promise<{ id: string; playerId: string }>
}

export async function PATCH(request: Request, { params }: RouteParams) {
  const { id, playerId } = await params
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  // Confirm ownership
  const { data: list } = await supabase
    .from('lists')
    .select('id, owner_id')
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle()
  if (!list) {
    return NextResponse.json({ error: 'List not found' }, { status: 404 })
  }
  if (list.owner_id !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { data: updated, error } = await supabase
    .from('list_players')
    .update({ tier: parsed.data.tier, updated_at: new Date().toISOString() })
    .eq('list_id', id)
    .eq('player_id', playerId)
    .select('player_id')

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  // Zero rows updated → the player isn't on this list. Surface a 404 so the
  // optimistic UI rolls back instead of trusting a phantom success.
  if (!updated || updated.length === 0) {
    return NextResponse.json(
      { error: 'Player is not on this list.' },
      { status: 404 },
    )
  }
  return NextResponse.json({ ok: true })
}
