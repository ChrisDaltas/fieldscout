import { NextResponse } from 'next/server'

import { nextPositionForList, notifyListFollowers } from '@/lib/lists/helpers'
import { createServerClient } from '@/lib/supabase/server'
import { addPlayerSchema } from '@/types/schemas/lists'

interface RouteParams {
  params: Promise<{ id: string }>
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

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = addPlayerSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  const { data: list, error: listError } = await supabase
    .from('lists')
    .select('id, owner_id')
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle()
  if (listError) {
    return NextResponse.json({ error: listError.message }, { status: 500 })
  }
  if (!list) {
    return NextResponse.json({ error: 'List not found' }, { status: 404 })
  }
  if (list.owner_id !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Confirm the player exists (avoid FK error).
  const { data: player, error: playerError } = await supabase
    .from('players')
    .select('id, full_name')
    .eq('id', parsed.data.player_id)
    .maybeSingle()
  if (playerError) {
    return NextResponse.json({ error: playerError.message }, { status: 500 })
  }
  if (!player) {
    return NextResponse.json({ error: 'Player not found' }, { status: 404 })
  }

  const position = await nextPositionForList(supabase, id)

  const { data: inserted, error: insertError } = await supabase
    .from('list_players')
    .insert({
      list_id: id,
      player_id: parsed.data.player_id,
      position,
      overall_rank: position,
      notes: parsed.data.notes ?? null,
    })
    .select(
      `id, player_id, position, tier, rank_in_tier, overall_rank, notes, added_at,
       player:players(id, full_name, position, team, headshot_url, status)`,
    )
    .single()

  if (insertError) {
    if (insertError.code === '23505') {
      return NextResponse.json(
        {
          error: `${player.full_name} is already on this list.`,
          code: 'DUPLICATE_PLAYER',
        },
        { status: 409 },
      )
    }
    return NextResponse.json({ error: insertError.message }, { status: 500 })
  }

  await notifyListFollowers(supabase, id, user.id)

  return NextResponse.json(inserted, { status: 201 })
}
