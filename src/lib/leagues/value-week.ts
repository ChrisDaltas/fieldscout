/** The week a free-agent list is about: the week being played, else the
 *  next one to be played, else (season over) the last. Undefined before the
 *  league has a schedule. */
export function valueWeekOf(weeks: readonly { week: number; status: string }[]): number | undefined {
  if (weeks.length === 0) return undefined
  const live = weeks.filter((w) => w.status === 'live').map((w) => w.week)
  if (live.length > 0) return Math.max(...live)
  const upcoming = weeks.filter((w) => w.status === 'upcoming').map((w) => w.week)
  if (upcoming.length > 0) return Math.min(...upcoming)
  return Math.max(...weeks.map((w) => w.week))
}
