import { fetchSchedule } from './schedule'
import type { SyncClient, SyncSummary } from './types'

const WEEK_COUNT = 18

/**
 * A team's bye is the one week in 1–18 where it plays no game (17-game
 * season). Team abbreviations match `players.team` — both come from Sleeper.
 */
export async function syncByeWeeks(
  supabase: SyncClient,
  season: number,
): Promise<SyncSummary> {
  const games = await fetchSchedule(season)

  const weeksByTeam = new Map<string, Set<number>>()
  for (const game of games) {
    if (!Number.isInteger(game.week) || game.week < 1 || game.week > WEEK_COUNT) continue
    for (const team of [game.home, game.away]) {
      if (!team) continue
      let weeks = weeksByTeam.get(team)
      if (!weeks) {
        weeks = new Set()
        weeksByTeam.set(team, weeks)
      }
      weeks.add(game.week)
    }
  }

  if (weeksByTeam.size === 0) {
    throw new Error('schedule is empty — nothing to sync')
  }

  const warnings: string[] = []
  const byeByTeam = new Map<string, number>()
  for (const [team, weeks] of weeksByTeam) {
    const byes = []
    for (let w = 1; w <= WEEK_COUNT; w++) {
      if (!weeks.has(w)) byes.push(w)
    }
    if (byes.length === 1) {
      byeByTeam.set(team, byes[0])
    } else {
      // 0 byes = malformed schedule; 2+ = schedule not fully published yet.
      // Skip rather than write a guess.
      warnings.push(`${team}: ${byes.length} open weeks — skipped`)
    }
  }

  let updated = 0
  for (const [team, bye] of byeByTeam) {
    const { error, count } = await supabase
      .from('players')
      .update({ bye_week: bye }, { count: 'exact' })
      .eq('team', team)
    if (error) throw new Error(`bye update failed for ${team}: ${error.message}`)
    updated += count ?? 0
  }

  return {
    name: 'bye-weeks',
    counts: { teams: byeByTeam.size, players: updated },
    warnings,
  }
}
