/**
 * Value Over Replacement Player (VORP) — the standard fantasy method for
 * ranking across positions when scarcity matters.
 *
 * Why we need it: raw projected points overrate QBs because the gap between
 * QB1 and QB12 is much smaller than the gap between RB1 and RB30. In a
 * 1-QB league the bottom 20 QBs are unrosterable, so a "top 300" board
 * sorted by raw points buries elite RB/WR talent under starter-quality
 * QBs nobody actually wants.
 *
 * VORP = projected_points(player) - projected_points(replacement_at_position)
 *
 * Replacement level = the first player at that position who isn't a starter
 * in a typical lineup. With 12 teams in a 1-QB league, only QB1–QB12 start
 * each week, so QB13 is "freely available off waivers" and represents zero
 * marginal value. Anything above QB13's projection is real value.
 */

export type VorpPosition = 'QB' | 'RB' | 'WR' | 'TE' | 'K' | 'DEF'

export interface VorpReplacementConfig {
  QB: number
  RB: number
  WR: number
  TE: number
  K: number
  DEF: number
}

/**
 * Default replacement ranks for a 12-team, 1-QB, 2-RB / 2-WR / 1-TE / 1-FLEX
 * league. The FLEX is split half-and-half across RB/WR (~6 of each), so
 * RBs and WRs effectively start ~30 deep.
 *
 *   QB starters = 12     → replacement = QB13
 *   RB starters = 24 + 6 → replacement = RB31
 *   WR starters = 24 + 6 → replacement = WR31
 *   TE starters = 12     → replacement = TE13
 *   K  starters = 12     → replacement = K13
 *   DEF starters = 12    → replacement = DEF13
 *
 * These are 1-indexed ranks of the replacement player itself (whose value
 * defines "zero VORP"), not the count of starters.
 */
export const DEFAULT_REPLACEMENT: VorpReplacementConfig = {
  QB: 13,
  RB: 31,
  WR: 31,
  TE: 13,
  K: 13,
  DEF: 13,
}

export interface VorpInput {
  id: string
  position: VorpPosition | string
  /** Pre-season projected points for the relevant scoring variant. */
  projected_pts: number | null | undefined
}

export interface VorpResult {
  id: string
  position: string
  projected_pts: number
  vorp: number
  /** Final cross-position rank (1-based). Lower is better. */
  fantasy_rank: number
}

function isFantasyPosition(p: string): p is VorpPosition {
  return p === 'QB' || p === 'RB' || p === 'WR' || p === 'TE' || p === 'K' || p === 'DEF'
}

/**
 * Compute VORP for each input player and return them sorted by VORP
 * (descending). Ties broken by raw projected points so a tied pair keeps a
 * deterministic order.
 *
 * Players without a projection get value = -Infinity and end up at the
 * bottom — never substitute zero, otherwise un-projected players would
 * jump rank past genuinely poor players whose projection is, say, 30 pts.
 *
 * Players at non-fantasy positions are filtered out.
 */
export function rankByVorp(
  players: VorpInput[],
  replacement: VorpReplacementConfig = DEFAULT_REPLACEMENT,
): VorpResult[] {
  const eligible = players.filter(
    (p): p is VorpInput & { position: VorpPosition } => isFantasyPosition(p.position),
  )

  // Per-position descending sort by projected points so we can index into
  // the replacement rank.
  const byPosition = new Map<VorpPosition, VorpInput[]>()
  for (const p of eligible) {
    const list = byPosition.get(p.position) ?? []
    list.push(p)
    byPosition.set(p.position, list)
  }
  const replacementValue: Record<VorpPosition, number> = {
    QB: 0, RB: 0, WR: 0, TE: 0, K: 0, DEF: 0,
  }
  byPosition.forEach((list, pos) => {
    list.sort(
      (a: VorpInput, b: VorpInput) =>
        (b.projected_pts ?? -Infinity) - (a.projected_pts ?? -Infinity),
    )
    const idx = Math.max(0, replacement[pos] - 1)
    const replacementPlayer = list[idx]
    replacementValue[pos] =
      typeof replacementPlayer?.projected_pts === 'number'
        ? replacementPlayer.projected_pts
        : 0
  })

  const scored: VorpResult[] = eligible.map((p) => {
    const proj = typeof p.projected_pts === 'number' ? p.projected_pts : null
    const vorp =
      proj === null
        ? Number.NEGATIVE_INFINITY
        : proj - replacementValue[p.position]
    return {
      id: p.id,
      position: p.position,
      projected_pts: proj ?? 0,
      vorp,
      fantasy_rank: 0,
    }
  })

  scored.sort((a, b) => {
    if (b.vorp !== a.vorp) return b.vorp - a.vorp
    return b.projected_pts - a.projected_pts
  })

  scored.forEach((row, i) => {
    row.fantasy_rank = i + 1
  })

  return scored
}
