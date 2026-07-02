import { NextResponse } from 'next/server'

import { createServerClient } from '@/lib/supabase/server'

/**
 * Mark notifications read. With a `{ ids: [...] }` body, marks just those;
 * otherwise marks every unread notification for the current user. RLS scopes
 * the update to the caller's own rows.
 */
export async function POST(request: Request) {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let ids: string[] | undefined
  try {
    const body = (await request.json()) as { ids?: unknown }
    if (Array.isArray(body?.ids)) {
      ids = body.ids.filter((v): v is string => typeof v === 'string')
    }
  } catch {
    // No / invalid body → mark all unread read.
  }

  let query = supabase
    .from('notifications')
    .update({ read: true })
    .eq('user_id', user.id)
    .eq('read', false)
  if (ids && ids.length > 0) query = query.in('id', ids)

  const { error } = await query
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
