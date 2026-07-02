import { NextResponse } from 'next/server'

import { createServerClient } from '@/lib/supabase/server'

interface RouteParams {
  params: Promise<{ snapshotId: string }>
}

/**
 * Returns the snapshot's denormalized player list. The caller (the grid)
 * applies it to working state — restore is *not* a save. The user must hit
 * "Update Big Board" to commit the restored state.
 */
export async function POST(_request: Request, { params }: RouteParams) {
  const { snapshotId } = await params
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data, error } = await supabase
    .from('big_board_snapshots')
    .select('id, saved_at, snapshot_data, user_id')
    .eq('id', snapshotId)
    .maybeSingle()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!data) {
    return NextResponse.json({ error: 'Snapshot not found' }, { status: 404 })
  }
  if (data.user_id !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  return NextResponse.json({
    id: data.id,
    saved_at: data.saved_at,
    snapshot_data: data.snapshot_data,
  })
}
