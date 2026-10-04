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

/** The hero's muted meta line: height · weight · Bye N — present parts only. */
export function heroMetaParts(player: PlayerStatsPlayer): string[] {
  const parts: string[] = []
  const height = formatHeight(player.height)
  if (height) parts.push(height)
  if (player.weight != null) parts.push(`${player.weight} lb`)
  if (player.bye_week != null) parts.push(`Bye ${player.bye_week}`)
  return parts
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

const POS_PLURAL: Record<string, string> = { QB: 'QBs', RB: 'RBs', WR: 'WRs', TE: 'TEs', K: 'kickers', DEF: 'defenses', DST: 'defenses' }

/** The Scout AI one-liner — ONLY when there is a next opponent AND a
 *  defense-vs-position rank for him. A plain fact, never advice. Null →
 *  the page omits the band. */
export function scoutMatchupRead(next: ScheduleRow | null, position: string): string | null {
  if (!next || next.opponent.kind !== 'game' || next.oprk === null) return null
  const vs = POS_PLURAL[position] ?? `${position}s`
  return `Week ${next.week} ${next.opponent.label}: that defense ranks ${ordinal(next.oprk)} toughest against ${vs}.`
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
