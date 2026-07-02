import { NextResponse } from 'next/server'

import { createServerClient } from '@/lib/supabase/server'
import { reorderPlayersSchema } from '@/types/schemas/lists'

interface RouteParams {
  params: Promise<{ id: string }>
}

export async function PATCH(request: Request, { params }: RouteParams) {
  const { id } = await params
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

  const parsed = reorderPlayersSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  // Atomic reorder via Postgres function. Function asserts ownership itself.
  const payload = parsed.data.positions.map(({ playerId, position }) => ({
    player_id: playerId,
    position,
  }))

  const { error } = await supabase.rpc('reorder_list_players', {
    p_list_id: id,
    p_positions: payload,
  })

  if (error) {
    const status = error.message.includes('Unauthorized')
      ? 401
      : error.message.includes('Forbidden')
        ? 403
        : error.message.includes('not found')
          ? 404
          : 500
    return NextResponse.json({ error: error.message }, { status })
  }

  return NextResponse.json({ ok: true })
}
