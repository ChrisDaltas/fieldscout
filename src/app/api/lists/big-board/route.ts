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
   player:players(id, full_name, position, team, headshot_url, status, adp, bye_week,
     projected_pts_ppr, projected_pts_half_ppr, projected_pts_standard, snap_pct, target_share, sos, auction_value)`

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

  const { data: initialPlayers, error: playersError } = await supabase
    .from('list_players')
    .select(PLAYER_SELECT)
    .eq('list_id', list.id)
    .order('position', { ascending: true })
  let players = initialPlayers

  if (playersError) {
    return NextResponse.json({ error: playersError.message }, { status: 500 })
  }

  // First-view auto-seed: if the Big Board is empty, populate the top 300
  // by VORP (positional-scarcity-aware ranking) so the order reflects
  // actual fantasy value rather than raw projected points.
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
    // Existing user from the old 50-player default — top up to 300
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
