import { NextResponse } from 'next/server'

import { createServerClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const [listRes, countRes] = await Promise.all([
    supabase
      .from('notifications')
      .select('id, type, title, body, data, read, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(50),
    supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('read', false),
  ])

  if (listRes.error) {
    return NextResponse.json({ error: listRes.error.message }, { status: 500 })
  }

  return NextResponse.json({
    notifications: listRes.data ?? [],
    unreadCount: countRes.count ?? 0,
  })
}
