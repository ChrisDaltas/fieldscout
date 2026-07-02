import { NextResponse } from 'next/server'

import {
  pickTopPlayersByVorp,
  seedListPlayers,
  topUpBigBoardToSize,
} from '@/lib/lists/seed-big-board'
import { createServerClient } from '@/lib/supabase/server'

const BIG_BOARD_DEFAULT_SIZE = 300

const PLAYER_SELECT =
  `id, player_id, position, tier, rank_in_tier, overall_rank, notes, added_at,
   player:players(id, full_name, position, team, headshot_url, status, adp, projected_pts_ppr)`

/**
 * Convenience endpoint for the season-long Big Board. Mirrors the existing
 * /api/lists/big-board route — kept here so callers in the new /api/big-board
 * namespace don't have to reach into /api/lists.
 */
export async function GET() {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: list, error: listError } = await supabase
    .from('lists')
    .select('*')
    .eq('owner_id', user.id)
    .eq('is_big_board', true)
    .is('deleted_at', null)
    .maybeSingle()

  if (listError) {
    return NextResponse.json({ error: listError.message }, { status: 500 })
  }
  if (!list) {
    return NextResponse.json(
      { error: 'Big Board not found for this user' },
      { status: 404 },
    )
  }

  const initialPlayers = await supabase
    .from('list_players')
    .select(PLAYER_SELECT)
    .eq('list_id', list.id)
    .order('position', { ascending: true })

  if (initialPlayers.error) {
    return NextResponse.json(
      { error: initialPlayers.error.message },
      { status: 500 },
    )
  }

  let players = initialPlayers.data

  if (!players || players.length === 0) {
    try {
      const topIds = await pickTopPlayersByVorp(supabase, BIG_BOARD_DEFAULT_SIZE)
      await seedListPlayers(supabase, list.id, topIds)
      const reread = await supabase
        .from('list_players')
        .select(PLAYER_SELECT)
        .eq('list_id', list.id)
        .order('position', { ascending: true })
      players = reread.data ?? []
    } catch (err) {
      console.error('Big Board auto-seed failed', err)
    }
  } else if (players.length < BIG_BOARD_DEFAULT_SIZE) {
    // Existing user from the old 50-player default — top them up to 300
    // without disturbing their hand-tuned order.
    try {
      await topUpBigBoardToSize(supabase, list.id, BIG_BOARD_DEFAULT_SIZE)
      const reread = await supabase
        .from('list_players')
        .select(PLAYER_SELECT)
        .eq('list_id', list.id)
        .order('position', { ascending: true })
      players = reread.data ?? players
    } catch (err) {
      console.error('Big Board top-up failed', err)
    }
  }

  return NextResponse.json({ list, players: players ?? [] })
}
