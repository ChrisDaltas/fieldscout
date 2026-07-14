/**
 * Live NFL season state from Sleeper — replaces the hand-maintained
 * NEXT_PUBLIC_NFL_WEEK env var that had to be bumped every week in season.
 *
 * Server-side only (uses Next's fetch cache). The env var survives as the
 * fallback when Sleeper is unreachable, and as an override for local testing
 * of in-season states: set NEXT_PUBLIC_NFL_WEEK_OVERRIDE to force a week.
 */

const STATE_URL = 'https://api.sleeper.app/v1/state/nfl'
const REVALIDATE_SECONDS = 3600

interface SleeperNflState {
  week: number | null
  season_type: 'pre' | 'regular' | 'post' | 'off' | string
}

function envFallbackWeek(): number {
  const n = Number(process.env.NEXT_PUBLIC_NFL_WEEK ?? 0)
  return Number.isInteger(n) && n >= 0 && n <= 18 ? n : 0
}

/**
 * The app's `currentWeek` semantics: 0 = offseason/preseason (week 1 is the
 * active board), 1–18 = that regular-season week. The postseason pins to 18
 * so season-long boards stay readable without unlocking phantom weeks.
 */
export async function getCurrentNflWeek(): Promise<number> {
  const override = Number(process.env.NEXT_PUBLIC_NFL_WEEK_OVERRIDE ?? NaN)
  if (Number.isInteger(override) && override >= 0 && override <= 18) {
    return override
  }

  try {
    const res = await fetch(STATE_URL, { next: { revalidate: REVALIDATE_SECONDS } })
    if (!res.ok) return envFallbackWeek()
    const state = (await res.json()) as SleeperNflState
    if (state.season_type === 'regular') {
      const week = Number(state.week ?? 0)
      return Number.isInteger(week) && week >= 1 && week <= 18 ? week : 1
    }
    if (state.season_type === 'post') return 18
    return 0 // pre / off
  } catch {
    return envFallbackWeek()
  }
}
