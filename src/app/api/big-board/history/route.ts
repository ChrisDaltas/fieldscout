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

  const { data, error } = await supabase
    .from('big_board_snapshots')
    .select('id, saved_at, snapshot_data')
    .eq('user_id', user.id)
    .order('saved_at', { ascending: false })
    .limit(100)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Send only player_count + saved_at in the list — full snapshot_data is
  // hydrated lazily via /restore when the user actually wants it. Keeps the
  // history list cheap to render even with many saves.
  type Row = { id: string; saved_at: string; snapshot_data: unknown[] }
  const snapshots = ((data as Row[] | null) ?? []).map((row) => ({
    id: row.id,
    saved_at: row.saved_at,
    player_count: Array.isArray(row.snapshot_data) ? row.snapshot_data.length : 0,
  }))

  return NextResponse.json({ snapshots })
}
