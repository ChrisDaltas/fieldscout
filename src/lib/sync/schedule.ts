import type { ScheduleGame } from '@/lib/sports-data/sos'

export interface SleeperScheduleGame extends ScheduleGame {
  status?: string | null
  date?: string | null
}

/** Regular-season schedule — shared by bye-week, SOS, and live syncs. */
export async function fetchSchedule(season: number): Promise<SleeperScheduleGame[]> {
  const url = `https://api.sleeper.com/schedule/nfl/regular/${season}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Schedule fetch failed: ${res.status}`)
  return (await res.json()) as SleeperScheduleGame[]
}
