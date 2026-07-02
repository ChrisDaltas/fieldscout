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

  // Confirm the list exists and is visible to this user.
  const { data: list, error: listError } = await supabase
    .from('lists')
    .select('id')
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle()
  if (listError) {
    return NextResponse.json({ error: listError.message }, { status: 500 })
  }
  if (!list) {
    return NextResponse.json({ error: 'List not found' }, { status: 404 })
  }

  const { data: existing, error: existingError } = await supabase
    .from('list_likes')
    .select('list_id')
    .eq('list_id', id)
    .eq('user_id', user.id)
    .maybeSingle()
  if (existingError) {
    return NextResponse.json({ error: existingError.message }, { status: 500 })
  }

  let liked: boolean
  if (existing) {
    const { error: delError } = await supabase
      .from('list_likes')
      .delete()
      .eq('list_id', id)
      .eq('user_id', user.id)
    if (delError) {
      return NextResponse.json({ error: delError.message }, { status: 500 })
    }
    liked = false
  } else {
    const { error: insError } = await supabase
      .from('list_likes')
      .insert({ list_id: id, user_id: user.id })
    // A concurrent double-tap can race past the existence check; the unique
    // (list_id, user_id) constraint then fires 23505 — treat that as "already
    // liked" rather than a 500.
    if (insError && insError.code !== '23505') {
      return NextResponse.json({ error: insError.message }, { status: 500 })
    }
    liked = true
  }

  // like_count is maintained by a trigger; read it back so the client can show
  // the authoritative total without guessing a delta.
  const { data: fresh } = await supabase
    .from('lists')
    .select('like_count')
    .eq('id', id)
    .maybeSingle()

  return NextResponse.json({ liked, like_count: fresh?.like_count ?? 0 })
}
