/**
 * Pure derivations for the full player page (built to the Claude Design
 * prototype's PlayerPage, Chris 2026-10-04). Every field is filled only from
 * a real source and OMITTED otherwise — the page never shows a placeholder
 * for data we do not have, and never writes advice of its own.
 */
import { oprkOf, oprkTone, opponentOf, type Opponent, type Tone } from '@/components/leagues/my-team-ops'
import type { PlayerStatsPlayer } from '@/hooks/use-player-stats'

// ---------------------------------------------------------------------------
// Vitals — one cell builder for the card (shows "—") and the page (omits)
// ---------------------------------------------------------------------------

export interface VitalCell {
  label: string
  /** Null when there is no real source for it — the page omits the cell. */
  value: string | null
}

export function vitalCells(player: PlayerStatsPlayer, today: Date): VitalCell[] {
  return [
    { label: 'ADP', value: formatAdp(player.adp) },
    { label: 'Auction $', value: player.auction_value != null ? `$${player.auction_value}` : null },
    // No positional rank source yet (F-row filed) — omitted on the page.
    { label: 'Pos rank', value: null },
    { label: 'SOS', value: player.sos != null ? `${player.sos} of 32` : null },
    { label: 'Height', value: formatHeight(player.height) },
    { label: 'Weight', value: player.weight != null ? `${player.weight} lb` : null },
    { label: 'Age', value: formatAge(player.birth_date, today) },
    { label: 'Seasons', value: Number.isFinite(player.experience_years) ? String(player.experience_years) : null },
  ]
}

/** The header's two identity lines (D486(12)): the badge line carries
 *  team · Bye Wk N; age, height and weight sit on a smaller muted line
 *  under it. Present parts only — each fact once on the page. */
export interface IdentityPart {
  key: 'age' | 'height' | 'weight' | 'bye'
  text: string
}

export function identityParts(player: PlayerStatsPlayer, today: Date): { primary: IdentityPart[]; secondary: IdentityPart[] } {
  const primary: IdentityPart[] = []
  if (player.bye_week != null) primary.push({ key: 'bye', text: `Bye Wk ${player.bye_week}` })
  const secondary: IdentityPart[] = []
  const age = formatAge(player.birth_date, today)
  if (age) secondary.push({ key: 'age', text: `Age ${age}` })
  const height = formatHeight(player.height)
  if (height) secondary.push({ key: 'height', text: height })
  if (player.weight != null) secondary.push({ key: 'weight', text: `${player.weight} lb` })
  return { primary, secondary }
}

/** The secondary "Draft & value" group: ADP · Auction $ · SOS — a value we
 *  do not have is omitted (empty array → the group is omitted). */
export function draftValueCells(player: PlayerStatsPlayer): Array<{ key: string; label: string; value: string }> {
  const cells: Array<{ key: string; label: string; value: string }> = []
  const adp = formatAdp(player.adp)
  if (adp) cells.push({ key: 'adp', label: 'ADP', value: adp })
  if (player.auction_value != null) cells.push({ key: 'auction', label: 'Auction $', value: `$${player.auction_value}` })
  if (player.sos != null) cells.push({ key: 'sos', label: 'SOS', value: `${player.sos} of 32` })
  return cells
}

export function formatAdp(adp: number | null): string | null {
  if (adp == null) return null
  const n = Number(adp)
  if (!Number.isFinite(n)) return null
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
}

/** The sync stores height as total inches in a string (e.g. "74" → 6'2"). */
export function formatHeight(height: string | null): string | null {
  if (!height) return null
  const inches = Number(height)
  if (!Number.isFinite(inches) || inches <= 0) return height
  return `${Math.floor(inches / 12)}'${inches % 12}"`
}

export function formatAge(birthDate: string | null, today: Date): string | null {
  if (!birthDate) return null
  const born = new Date(birthDate)
  if (Number.isNaN(born.getTime())) return null
  let age = today.getFullYear() - born.getFullYear()
  const beforeBirthday =
    today.getMonth() < born.getMonth() ||
    (today.getMonth() === born.getMonth() && today.getDate() < born.getDate())
  if (beforeBirthday) age -= 1
  return age > 0 ? String(age) : null
}

// ---------------------------------------------------------------------------
// Schedule + the Scout AI matchup read
// ---------------------------------------------------------------------------

export interface TeamGame {
  week: number
  home_team: string
  away_team: string
  kickoff_at: string
  status: string | null
}

export interface DefenseSplitRow {
  defense: string
  position: string
  rank: number
}

export interface ScheduleRow {
  week: number
  opponent: Opponent
  oprk: number | null
  tone: Tone | null
  final: boolean
}

/** One row per week the team has a game, plus the bye week when the player
 *  record carries one — ordered by week. OPRK only when the split exists. */
export function scheduleRows(
  team: string | null,
  position: string,
  games: readonly TeamGame[],
  splits: readonly DefenseSplitRow[],
  byeWeek: number | null,
): ScheduleRow[] {
  if (!team) return []
  const rows: ScheduleRow[] = games.map((g) => {
    const opponent = opponentOf(team, [g])
    const opp = opponent.kind === 'game' ? opponent.opp : null
    const oprk = oprkOf(splits, opp, position)
    return { week: g.week, opponent, oprk, tone: oprk === null ? null : oprkTone(oprk), final: g.status === 'final' }
  })
  if (byeWeek != null && games.length > 0 && !rows.some((r) => r.week === byeWeek)) {
    rows.push({ week: byeWeek, opponent: { kind: 'bye' }, oprk: null, tone: null, final: false })
  }
  return rows.sort((a, b) => a.week - b.week)
}

/** The next matchup: the first game still `scheduled` (001's default) —
 *  read from the stored status, never from a clock. */
export function nextScheduled(rows: readonly ScheduleRow[], games: readonly TeamGame[]): ScheduleRow | null {
  for (const g of [...games].sort((a, b) => a.week - b.week)) {
    if (g.status !== 'scheduled') continue // R1502: null is not scheduled
    return rows.find((r) => r.week === g.week && r.opponent.kind === 'game') ?? null
  }
  return null
}

export type ThisWeek =
  | {
      kind: 'game'
      week: number
      home: boolean
      opp: string
      kickoff_at: string
      /** OPRK (1 = toughest) and the size of the ranked set, or null. */
      oprk: number | null
      ranked: number
    }
  | { kind: 'bye'; week: number }

/**
 * "This week" for the hero's matchup block (D486(12)), read from STORED game
 * status — never a clock. The week is his next `scheduled` game, unless his
 * bye week falls after every game already played and before that next game
 * (then it is his bye). No game data → null, and the block is omitted.
 */
export function thisWeek(
  team: string | null,
  position: string,
  games: readonly TeamGame[],
  splits: readonly DefenseSplitRow[],
  byeWeek: number | null,
): ThisWeek | null {
  if (!team || games.length === 0) return null
  const sorted = [...games].sort((a, b) => a.week - b.week)
  const next = sorted.find((g) => g.status === 'scheduled') ?? null
  const lastPlayed = Math.max(0, ...sorted.filter((g) => g.status !== 'scheduled').map((g) => g.week))
  if (byeWeek != null && byeWeek > lastPlayed && (next === null || byeWeek < next.week)) {
    return next === null && lastPlayed === 0 ? null : { kind: 'bye', week: byeWeek }
  }
  if (!next) return null
  const home = next.home_team === team
  const opp = home ? next.away_team : next.home_team
  const pos = position === 'DST' ? 'DEF' : position
  const ranked = splits.filter((s) => s.position === pos && s.rank > 0).length
  return { kind: 'game', week: next.week, home, opp, kickoff_at: next.kickoff_at, oprk: oprkOf(splits, opp, position), ranked }
}

/** The matchup badge — the shorter side of the order: the top half reads
 *  "Nth toughest vs POS", the bottom half "Nth easiest vs POS" counted from
 *  the bottom. Tone is My Team's OPRK chip tone (`oprkTone`). */
export function matchupBadge(oprk: number, ranked: number, position: string): { text: string; tone: Tone } {
  const total = Math.max(ranked, oprk)
  const pos = position === 'DST' ? 'DEF' : position
  const text =
    oprk <= Math.ceil(total / 2)
      ? `${ordinal(oprk)} toughest vs ${pos}`
      : `${ordinal(total + 1 - oprk)} easiest vs ${pos}`
  return { text, tone: oprkTone(oprk) }
}

/** One row of the season table (D486(12), Yahoo's single table):
 *  Wk · Opp (with the defense rank vs his position) · Proj · Pts. */
export interface SeasonTableRow {
  week: number
  /** Null when the week has numbers but no game on file. */
  opponent: Opponent | null
  oprk: number | null
  tone: Tone | null
  /** Unplayed game: its kickoff (shown where the points will go). */
  kickoff_at: string | null
  proj: number | null
  points: number | null
  current: boolean
}

/**
 * Every week of his season in one list: the schedule (games + the bye) and
 * any week with points or a projection. Points only for completed games
 * (the server's rule); an unplayed game carries its kickoff instead.
 * `currentWeek` marks the row.
 */
export function seasonTable(
  schedule: readonly ScheduleRow[],
  games: readonly TeamGame[],
  weekly: ReadonlyArray<{ week: number; points: number | null; proj: number | null }>,
  currentWeek: number | null,
): SeasonTableRow[] {
  const byWeek = new Map<number, SeasonTableRow>()
  for (const r of schedule) {
    const g = r.opponent.kind === 'game' ? games.find((x) => x.week === r.week) : undefined
    byWeek.set(r.week, {
      week: r.week,
      opponent: r.opponent,
      oprk: r.oprk,
      tone: r.tone,
      kickoff_at: g && g.status === 'scheduled' ? g.kickoff_at : null,
      proj: null,
      points: null,
      current: r.week === currentWeek,
    })
  }
  for (const w of weekly) {
    const row = byWeek.get(w.week) ?? {
      week: w.week, opponent: null, oprk: null, tone: null, kickoff_at: null, proj: null, points: null, current: w.week === currentWeek,
    }
    if (row.opponent?.kind === 'bye') continue
    byWeek.set(w.week, { ...row, proj: w.proj, points: w.points })
  }
  return [...byWeek.values()].sort((a, b) => a.week - b.week)
}

/** The Opp cell: "@ HOU (8th)" — the rank only when we have it. */
export function oppCell(row: SeasonTableRow): string {
  if (!row.opponent || row.opponent.kind === 'unknown') return '—'
  if (row.opponent.kind === 'bye') return 'BYE'
  return row.opponent.label
}

/** Kickoff for an unplayed week: "Sun 1:00 PM" (Eastern). */
export function shortKickoff(iso: string): string | null {
  const full = formatKickoff(iso)
  return full ? full.replace(/ ET$/, '') : null
}

/** Kickoff in Eastern time, the NFL's own convention: "Sun 1:00 PM ET". */
export function formatKickoff(iso: string): string | null {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const s = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(d)
  return `${s} ET`
}

export function ordinal(n: number): string {
  const mod100 = n % 100
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`
  switch (n % 10) {
    case 1:
      return `${n}st`
    case 2:
      return `${n}nd`
    case 3:
      return `${n}rd`
    default:
      return `${n}th`
  }
}

/** The full page's URL — the league variant carries `?league=`. */
export function playerPageHref(playerId: string, leagueId?: string | null): string {
  return leagueId ? `/app/players/${playerId}?league=${encodeURIComponent(leagueId)}` : `/app/players/${playerId}`
}
