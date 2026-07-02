import type { SupabaseClient } from '@supabase/supabase-js'

import {
  calculateFantasyPoints,
  PPR_SCORING,
  type StatRow,
} from '@/lib/scoring/default'
import { rankByVorp, type VorpPosition } from '@/lib/scoring/vorp'

const STATS_SELECT =
  'player_id, ' +
  'pass_yards, pass_tds, interceptions, sacks_taken, ' +
  'rush_yards, rush_tds, fumbles_lost, ' +
  'receptions, receiving_yards, receiving_tds, ' +
  'fg_made, fg_made_40_plus, fg_made_50_plus, xp_made, ' +
  'def_sacks, def_interceptions, def_fumble_recoveries, def_tds, def_safeties, ' +
  'two_point_conversions'

const FANTASY_POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF']

/**
 * Pick top-N fantasy-relevant players by aggregate 2025 PPR points. Used to
 * seed the Big Board on first view so the user has a meaningful starting set
 * instead of a blank list (PRD F2A: default size is top 50).
 */
export async function pickTopPlayersByLastSeason(
  supabase: SupabaseClient,
  limit: number,
  season = 2025,
): Promise<string[]> {
  // Cast a wide net first — most fantasy-relevant players appear in the
  // weekly stats. We aggregate to season totals in JS to keep this portable
  // without an SQL function.
  const { data: rows, error } = await supabase
    .from('player_stats')
    .select(STATS_SELECT)
    .eq('season', season)
    .not('week', 'is', null)
  if (error) throw error

  const totalsByPlayer = new Map<string, StatRow>()
  for (const raw of rows ?? []) {
    const row = raw as unknown as Record<string, unknown>
    const pid = row.player_id as string
    let acc = totalsByPlayer.get(pid)
    if (!acc) {
      acc = {}
      totalsByPlayer.set(pid, acc)
    }
    const accAny = acc as Record<string, number>
    for (const [k, v] of Object.entries(row)) {
      if (k === 'player_id') continue
      accAny[k] = (accAny[k] ?? 0) + Number(v ?? 0)
    }
  }

  // Filter to fantasy-relevant positions on a current NFL roster. Sleeper
  // marks legendary retirees as active=true (Frank Gore, etc.) — the reliable
  // "still in the league" signal is having a non-null team.
  const playerIds = Array.from(totalsByPlayer.keys())
  if (playerIds.length === 0) return []

  const { data: positions } = await supabase
    .from('players')
    .select('id, position, status, team')
    .in('id', playerIds)
    .not('team', 'is', null)
  const validPlayers = new Map<string, string>()
  for (const p of positions ?? []) {
    if (FANTASY_POSITIONS.includes(p.position as string)) {
      validPlayers.set(p.id as string, p.position as string)
    }
  }

  // Score and rank
  const scored: { id: string; pts: number }[] = []
  totalsByPlayer.forEach((totals, pid) => {
    if (!validPlayers.has(pid)) return
    scored.push({ id: pid, pts: calculateFantasyPoints(totals, PPR_SCORING) })
  })
  scored.sort((a, b) => b.pts - a.pts)
  return scored.slice(0, limit).map((s) => s.id)
}

/**
 * Insert the given player IDs as Big Board entries starting at position 1.
 * Caller should only invoke when the list is currently empty.
 */
export async function seedListPlayers(
  supabase: SupabaseClient,
  listId: string,
  playerIds: string[],
): Promise<number> {
  if (playerIds.length === 0) return 0
  const rows = playerIds.map((player_id, i) => ({
    list_id: listId,
    player_id,
    position: i + 1,
    overall_rank: i + 1,
  }))
  const { error } = await supabase.from('list_players').insert(rows)
  if (error) throw error
  return rows.length
}

/**
 * Pick the top-N fantasy players for the upcoming season ranked by VORP,
 * not raw projected points. This is the rank that actually reflects how
 * the players are valued: scarcity at RB/WR pushes them above many QBs
 * even when QB projections are higher in absolute terms.
 *
 * Falls back to last-season totals only for players Sleeper hasn't
 * projected yet — better than dropping them, and they'll naturally sort
 * below projected players because their VORP is computed against the
 * same positional replacement value.
 */
export async function pickTopPlayersByVorp(
  supabase: SupabaseClient,
  limit: number,
): Promise<string[]> {
  const all: Array<{
    id: string
    position: string
    projected_pts_ppr: number | null
  }> = []
  const pageSize = 1000
  let offset = 0
  while (true) {
    const { data, error } = await supabase
      .from('players')
      .select('id, position, projected_pts_ppr')
      .not('team', 'is', null)
      .in('position', ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'])
      .range(offset, offset + pageSize - 1)
    if (error) throw error
    if (!data || data.length === 0) break
    for (const row of data) {
      all.push(row as typeof all[number])
    }
    if (data.length < pageSize) break
    offset += pageSize
  }

  const ranked = rankByVorp(
    all.map((p) => ({
      id: p.id,
      position: p.position as VorpPosition,
      projected_pts:
        typeof p.projected_pts_ppr === 'number' ? p.projected_pts_ppr : null,
    })),
  )
  return ranked.slice(0, limit).map((r) => r.id)
}

/**
 * Top up an existing Big Board to the desired size by appending VORP-ranked
 * players that aren't already on the list. Idempotent: if the board is
 * already at or above `targetSize`, does nothing. Used for the F2A
 * migration from the old 50-player default to the new 300-player default
 * — existing users get expanded without losing their hand-tuned order.
 */
export async function topUpBigBoardToSize(
  supabase: SupabaseClient,
  listId: string,
  targetSize: number,
): Promise<number> {
  const { data: existing } = await supabase
    .from('list_players')
    .select('player_id, position')
    .eq('list_id', listId)
    .order('position', { ascending: false })
    .limit(1)
  const currentMax = existing?.[0]?.position ?? 0
  if (currentMax >= targetSize) return 0

  const existingIds = new Set<string>()
  let offset = 0
  while (true) {
    const { data } = await supabase
      .from('list_players')
      .select('player_id')
      .eq('list_id', listId)
      .range(offset, offset + 999)
    if (!data || data.length === 0) break
    for (const r of data) existingIds.add(r.player_id as string)
    if (data.length < 1000) break
    offset += 1000
  }

  const ranked = await pickTopPlayersByVorp(supabase, targetSize * 2)
  const additions = ranked
    .filter((id) => !existingIds.has(id))
    .slice(0, targetSize - currentMax)

  if (additions.length === 0) return 0
  const rows = additions.map((player_id, i) => ({
    list_id: listId,
    player_id,
    position: currentMax + i + 1,
    overall_rank: currentMax + i + 1,
  }))
  const { error } = await supabase.from('list_players').insert(rows)
  if (error) throw error
  return rows.length
}
