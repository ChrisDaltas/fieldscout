import { NextResponse } from 'next/server'

import { createServerClient } from '@/lib/supabase/server'

interface RouteParams {
  params: Promise<{ id: string }>
}

export async function POST(_request: Request, { params }: RouteParams) {
  const { id } = await params
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Any signed-in user can favorite a list, as long as it's not soft-deleted
  // and not private (or they own it).
  const { data: list, error: fetchError } = await supabase
    .from('lists')
    .select('id, owner_id, is_private')
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle()
  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 500 })
  }
  if (!list) {
    return NextResponse.json({ error: 'List not found' }, { status: 404 })
  }
  if (list.is_private && list.owner_id !== user.id) {
    return NextResponse.json(
      { error: 'Cannot favorite a private list.' },
      { status: 403 },
    )
  }

  // Toggle by row presence in list_favorites.
  const { data: existing, error: existingError } = await supabase
    .from('list_favorites')
    .select('user_id')
    .eq('user_id', user.id)
    .eq('list_id', id)
    .maybeSingle()
  if (existingError) {
    return NextResponse.json({ error: existingError.message }, { status: 500 })
  }

  if (existing) {
    const { error: deleteError } = await supabase
      .from('list_favorites')
      .delete()
      .eq('user_id', user.id)
      .eq('list_id', id)
    if (deleteError) {
      return NextResponse.json({ error: deleteError.message }, { status: 500 })
    }
    return NextResponse.json({ is_favorited: false })
  }

  const { error: insertError } = await supabase
    .from('list_favorites')
    .insert({ user_id: user.id, list_id: id })
  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 })
  }
  return NextResponse.json({ is_favorited: true })
}
