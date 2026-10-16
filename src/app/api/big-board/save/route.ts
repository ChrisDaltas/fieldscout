import { NextResponse } from 'next/server'
import { z } from 'zod'

import {
  publishPositionsSchema,
  rpcPositions,
  saveScoringFormat,
  scoringFormatSchema,
  type PublishPosition,
  type ScoringSave,
} from '@/lib/lists/ranking-publish'
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
 *
 * A save is a publish of the board (migration 190, Chris 2026-10-15): the
 * RPC records each sent row's previous position for the movement arrows.
 * Players this save ADDS have none — the phone flags the ones its publish
 * bulk-added (`isNew`), and the `playerIds` path flags the ones it inserts.
 * `scoringFormat` (the scoring the ranking was made for, phone #36) is saved
 * on the board; before 190 is pushed that is reported as `unsupported` and
 * the save still succeeds.
 */
const saveSchema = z.object({
  positions: publishPositionsSchema.optional(),
  playerIds: z.array(z.string().min(1)).optional(),
  scoringFormat: scoringFormatSchema.optional(),
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
  let positions: PublishPosition[] | undefined = parsed.data.positions
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
    // The players this save inserted have no previous position.
    const added = new Set(toAdd)
    positions = ids.map((playerId, i) => ({ playerId, position: i + 1, isNew: added.has(playerId) }))
  }

  if (!positions) {
    return NextResponse.json({ error: 'No positions resolved' }, { status: 400 })
  }

  const { error: rpcError } = await supabase.rpc('reorder_list_players', {
    p_list_id: list.id,
    p_positions: rpcPositions(positions),
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

  // The order is saved. Its scoring is reported, never a failed save: the
  // phone tells the user if it didn't stick.
  let scoring: ScoringSave | undefined
  let scoringError: string | undefined
  if (parsed.data.scoringFormat) {
    try {
      scoring = await saveScoringFormat(supabase, list.id, parsed.data.scoringFormat)
    } catch (err) {
      scoringError = err instanceof Error ? err.message : String(err)
    }
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
      scoring,
      scoringError,
    })
  }

  return NextResponse.json({ ok: true, snapshot, scoring, scoringError })
}
