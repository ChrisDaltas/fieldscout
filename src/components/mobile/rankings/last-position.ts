import { isRankPos, type RankPos } from '@/components/mobile/rankings/rankings-ops'

/**
 * Rankings start on the position you last used (Chris, 2026-10-15, gap list
 * #32) — the hub's chips and New ranking — remembered on this device only.
 * Storage can be blocked or cleared (a private window, site data off): then
 * nothing is remembered and RB stays the start.
 */
export const LAST_RANK_POS_KEY = 'fs.mobile-rankings.last-pos'

export function readLastRankPos(): RankPos | null {
  try {
    const v = window.localStorage.getItem(LAST_RANK_POS_KEY)
    return isRankPos(v) ? v : null
  } catch {
    return null
  }
}

export function rememberRankPos(pos: RankPos): void {
  try {
    window.localStorage.setItem(LAST_RANK_POS_KEY, pos)
  } catch {
    // Storage blocked: nothing is remembered, and that's fine.
  }
}
