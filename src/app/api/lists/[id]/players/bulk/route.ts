import { NextResponse } from 'next/server'
import { z } from 'zod'

import { nextPositionForList, notifyListFollowers } from '@/lib/lists/helpers'
import { createServerClient } from '@/lib/supabase/server'

const bodySchema = z.object({
  player_ids: z.array(z.string().min(1)).min(1).max(500),
})

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

  const parsed = bodySchema.safeParse(body)
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

  const requestedIds = Array.from(new Set(parsed.data.player_ids))

  // Validate that the players exist
  const { data: existingPlayers } = await supabase
    .from('players')
    .select('id')
    .in('id', requestedIds)
  const validIds = new Set((existingPlayers ?? []).map((p) => p.id as string))
  const orderedValidIds = requestedIds.filter((id) => validIds.has(id))

  // Skip players already on the list
  const { data: alreadyAdded } = await supabase
    .from('list_players')
    .select('player_id')
    .eq('list_id', id)
    .in('player_id', orderedValidIds)
  const alreadyOnList = new Set((alreadyAdded ?? []).map((r) => r.player_id as string))
  const toInsert = orderedValidIds.filter((id) => !alreadyOnList.has(id))

  if (toInsert.length === 0) {
    return NextResponse.json({ inserted: 0, skipped: requestedIds.length })
  }

  let nextPos = await nextPositionForList(supabase, id)
  const rows = toInsert.map((player_id) => ({
    list_id: id,
    player_id,
    position: nextPos,
    overall_rank: nextPos++,
  }))

  const { error: insertError } = await supabase.from('list_players').insert(rows)
  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 })
  }

  await notifyListFollowers(supabase, id, user.id)

  return NextResponse.json({
    inserted: rows.length,
    skipped: requestedIds.length - rows.length,
  })
}
