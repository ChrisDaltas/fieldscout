import { NextResponse } from 'next/server'

import { notifyListFollowers } from '@/lib/lists/helpers'
import { createServerClient } from '@/lib/supabase/server'

interface RouteParams {
  params: Promise<{ id: string; playerId: string }>
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const { id, playerId } = await params
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
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

  const { error: deleteError } = await supabase
    .from('list_players')
    .delete()
    .eq('list_id', id)
    .eq('player_id', playerId)
  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 })
  }

  await notifyListFollowers(supabase, id, user.id)

  return NextResponse.json({ ok: true })
}
