import { NextResponse } from 'next/server'
import { z } from 'zod'

import { createServerClient } from '@/lib/supabase/server'

/**
 * Save the working Big Board state. Two side effects:
 *   1. Reorder list_players atomically (delegates to the reorder_list_players
 *      RPC so positions stay collision-free).
 *   2. Append a row to big_board_snapshots capturing the full ordered list.
 *      The snapshot is denormalized so the user can restore even after a
 *      player is removed elsewhere.
 *
 * The client may also pass `playerIds` to fully replace the working set —
 * useful for "add via search" / "smart order" flows where the working state
 * has rows not yet persisted, or fewer rows than what's on the server. When
 * playerIds is omitted we just reorder what's already there.
 */
const saveSchema = z.object({
  positions: z
    .array(
      z.object({
        playerId: z.string().min(1),
        position: z.number().int().positive(),
      }),
    )
    .min(1)
    .optional(),
  playerIds: z.array(z.string().min(1)).optional(),
}).refine((v) => v.positions || v.playerIds, {
  message: 'Provide positions or playerIds',
})

export async function POST(request: Request) {
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
  const parsed = saveSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  const { data: list, error: listError } = await supabase
    .from('lists')
    .select('id')
    .eq('owner_id', user.id)
    .eq('is_big_board', true)
    .is('deleted_at', null)
    .maybeSingle()
  if (listError) {
    return NextResponse.json({ error: listError.message }, { status: 500 })
  }
  if (!list) {
    return NextResponse.json({ error: 'Big Board not found' }, { status: 404 })
  }

  // Fully replace the working set if playerIds was provided.
  let positions = parsed.data.positions
  if (parsed.data.playerIds) {
    const ids = parsed.data.playerIds
    const { data: existing } = await supabase
      .from('list_players')
      .select('player_id')
      .eq('list_id', list.id)
    const existingIds = new Set((existing ?? []).map((r) => r.player_id as string))
    const desired = new Set(ids)

    const toRemove = Array.from(existingIds).filter((id) => !desired.has(id))
    const toAdd = ids.filter((id) => !existingIds.has(id))

    if (toRemove.length > 0) {
      const { error: delErr } = await supabase
        .from('list_players')
        .delete()
        .eq('list_id', list.id)
        .in('player_id', toRemove)
      if (delErr) {
        return NextResponse.json({ error: delErr.message }, { status: 500 })
      }
    }
    if (toAdd.length > 0) {
      const insertRows = toAdd.map((player_id) => ({
        list_id: list.id,
        player_id,
        position: ids.indexOf(player_id) + 1,
        overall_rank: ids.indexOf(player_id) + 1,
      }))
      const { error: insErr } = await supabase
        .from('list_players')
        .insert(insertRows)
      if (insErr) {
        return NextResponse.json({ error: insErr.message }, { status: 500 })
      }
    }
    positions = ids.map((playerId, i) => ({ playerId, position: i + 1 }))
  }

  if (!positions) {
    return NextResponse.json({ error: 'No positions resolved' }, { status: 400 })
  }

  const payload = positions.map(({ playerId, position }) => ({
    player_id: playerId,
    position,
  }))
  const { error: rpcError } = await supabase.rpc('reorder_list_players', {
    p_list_id: list.id,
    p_positions: payload,
  })
  if (rpcError) {
    const status = rpcError.message.includes('Unauthorized')
      ? 401
      : rpcError.message.includes('Forbidden')
        ? 403
        : rpcError.message.includes('not found')
          ? 404
          : 500
    return NextResponse.json({ error: rpcError.message }, { status })
  }

  // Re-read the saved board so the snapshot has full denormalized data.
  const { data: saved, error: rereadError } = await supabase
    .from('list_players')
    .select(
      `player_id, position,
       player:players(id, full_name, position, team, headshot_url)`,
    )
    .eq('list_id', list.id)
    .order('position', { ascending: true })
  if (rereadError) {
    return NextResponse.json({ error: rereadError.message }, { status: 500 })
  }

  type PlayerJoin = {
    id: string
    full_name: string
    position: string
    team: string | null
    headshot_url: string | null
  }
  type Row = {
    player_id: string
    position: number
    // Supabase types FK joins as arrays even for to-one relations.
    player: PlayerJoin | PlayerJoin[] | null
  }
  const rows = (saved ?? []) as unknown as Row[]
  const snapshotData = rows.map((row) => {
    const playerObj = Array.isArray(row.player) ? row.player[0] : row.player
    return {
      player_id: row.player_id,
      position: row.position,
      full_name: playerObj?.full_name ?? '',
      position_code: playerObj?.position ?? '',
      team: playerObj?.team ?? null,
      headshot_url: playerObj?.headshot_url ?? null,
    }
  })

  const { data: snapshot, error: snapshotError } = await supabase
    .from('big_board_snapshots')
    .insert({ user_id: user.id, snapshot_data: snapshotData })
    .select('id, saved_at')
    .single()
  if (snapshotError) {
    // Snapshot is nice-to-have but the save itself succeeded — surface a soft
    // warning rather than failing the whole request.
    return NextResponse.json({
      ok: true,
      snapshotError: snapshotError.message,
    })
  }

  return NextResponse.json({ ok: true, snapshot })
}
