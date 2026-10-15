/**
 * Pure helpers for the mobile Home (FieldScout Mobile handoff, m-home.md).
 * No time, DOM or fetch here — callers pass `now` where a clock matters.
 */
import type { ScoringFamily } from '@/components/draft/auction-player-table-ops'
import type { StandingsRow } from '@/lib/leagues/api/standings-service'

/**
 * The league Trending "See all" opens (m-home §3 `homeTrendAll`: League ›
 * Players, Available): the user's first league with a season in play, else
 * their first league that isn't finished — in the app's league order. None
 * (no leagues, or only finished ones) hides the link.
 */
export function trendSeeAllHref(leagues: readonly { id: string; status: string }[]): string | null {
  const league = leagues.find((l) => seasonInPlay(l.status)) ?? leagues.find((l) => l.status !== 'complete')
  return league ? `/app/leagues/${league.id}/players?status=avail` : null
}

/** "1 list" / "3 lists". */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

/**
 * Where a league stands, for its Home card (m-home §2A.5, Q8):
 *  - `pre-draft` (setup / scheduled): the "Pre-draft" pill; the card opens
 *    the League tab's draft home (checklist, countdown, lobby);
 *  - `draft-live` (drafting): a "Draft live" pill; the card opens the draft
 *    room (desktop labels the same status "Draft live");
 *  - `season` (in season, playoffs, finished): the week's matchup; the card
 *    opens the Match tab.
 */
export type LeaguePhase = 'pre-draft' | 'draft-live' | 'season'

export function leaguePhase(status: string): LeaguePhase {
  if (status === 'setup' || status === 'scheduled') return 'pre-draft'
  if (status === 'drafting') return 'draft-live'
  return 'season'
}

/** A season being played — the Matchups header's week comes from one. */
export function seasonInPlay(status: string): boolean {
  return status === 'in_season' || status === 'playoffs'
}

/**
 * A league whose rosters are this season's: drafting, in season or in the
 * playoffs. A finished league's rosters are last season's, so they don't
 * make a player "On your roster".
 */
export function hasCurrentRoster(status: string): boolean {
  return status === 'drafting' || seasonInPlay(status)
}

/** The scoring word on a league card sub ("12-team PPR · Week 5"). */
export function scoringWord(family: ScoringFamily | null): string | null {
  if (family === 'ppr') return 'PPR'
  if (family === 'half_ppr') return 'half PPR'
  if (family === 'standard') return 'standard'
  return null
}

/**
 * League card sub (m-home §5): in season `{N}-team {scoring} · Week {wk}`;
 * before the season (pre-draft or drafting) `{N}-team {scoring} · {season}`.
 * A part with no source is left out rather than guessed.
 */
export function leagueSub(input: {
  teamCount: number
  family: ScoringFamily | null
  beforeSeason: boolean
  season: number
  week: number | null
}): string {
  const word = scoringWord(input.family)
  const size = `${input.teamCount}-team${word ? ` ${word}` : ''}`
  const when = !input.beforeSeason && input.week !== null ? `Week ${input.week}` : String(input.season)
  return `${size} · ${when}`
}

/**
 * A team's record from the final standings ("2-6", ties "2-6-1"). Before any
 * week is final the RPC says so (`no_final_weeks`) and every record is 0-0;
 * a team missing from a non-empty table has no record to show (null).
 */
export function recordText(
  standings: { standings: Pick<StandingsRow, 'team_id' | 'wins' | 'losses' | 'ties'>[]; reason: string | null } | undefined,
  teamId: string,
): string | null {
  if (!standings) return null
  const row = standings.standings.find((r) => r.team_id === teamId)
  if (row) return `${row.wins}-${row.losses}${row.ties ? `-${row.ties}` : ''}`
  if (standings.reason === 'no_final_weeks') return '0-0'
  return null
}

/** "Touchdown Tacos (2-6)" — the name alone when there is no record. */
export function teamWithRecord(name: string, record: string | null): string {
  return record ? `${name} (${record})` : name
}

/** "Proj 83.44" — only when every starter has a stored projection (the
 *  matchup page's rule: a partial sum is never shown). */
export function projText(total: { total: number; missing: number } | null, filled: number): string | null {
  if (!total || filled === 0 || total.missing > 0) return null
  return `Proj ${total.total.toFixed(2)}`
}

/** A signed one-decimal delta with a real minus (U+2212), e.g. "+12.3" / "−4.0". */
export function signedDelta(delta: number): string {
  const text = Math.abs(delta).toFixed(1)
  return delta < 0 ? `−${text}` : `+${text}`
}

/**
 * Trending players — the app's one trend signal (the desktop Home's
 * `TrendingPlayersCard` rule, unchanged): this season's projection against
 * last season's actual points, for relevant players with a real last season.
 * Risers: biggest gain first. Fallers: biggest drop first.
 */
export const TREND_RELEVANCE_FLOOR = 50
export const TREND_MIN_LAST_GAMES = 8

export interface TrendEntry<T> {
  player: T
  delta: number
}

export function trendLists<T extends { projected_pts: number | null; last_pts: number; last_games: number }>(
  players: readonly T[],
  n = 5,
): { risers: TrendEntry<T>[]; fallers: TrendEntry<T>[] } {
  const candidates = players
    .filter((p) => p.projected_pts !== null && p.projected_pts >= TREND_RELEVANCE_FLOOR && p.last_games >= TREND_MIN_LAST_GAMES)
    .map((p) => ({ player: p, delta: (p.projected_pts ?? 0) - p.last_pts }))
  const byDeltaDesc = [...candidates].sort((a, b) => b.delta - a.delta)
  return {
    risers: byDeltaDesc.filter((e) => e.delta > 0).slice(0, n),
    fallers: byDeltaDesc
      .filter((e) => e.delta < 0)
      .reverse()
      .slice(0, n),
  }
}

/** The injury designations Home's "Injury news" reports, most severe last. */
export const INJURY_STATUSES = ['Questionable', 'Doubtful', 'Out', 'IR', 'PUP'] as const

/** Status pill fill (m-home §5): Questionable orange, Out red, IR ink. */
export function injuryPillClass(status: string): string {
  if (status === 'Questionable') return 'bg-warn'
  if (status === 'Doubtful' || status === 'Out') return 'bg-negative-strong'
  return 'bg-m-ink'
}

/**
 * The injury note under a name, from the synced injury fields: body part,
 * the feed's note and practice participation ("Ankle · Sprain · limited
 * practice"). Null when the feed has nothing to say.
 */
export function injuryNote(p: {
  injury_body_part: string | null
  injury_notes: string | null
  practice_participation: string | null
}): string | null {
  const parts: string[] = []
  if (p.injury_body_part) parts.push(p.injury_body_part)
  if (p.injury_notes) parts.push(p.injury_notes)
  if (p.practice_participation) parts.push(`${p.practice_participation.toLowerCase()} practice`)
  return parts.length > 0 ? parts.join(' · ') : null
}

/** "today" / "3d ago" / "2w ago" / "4mo ago" — the AI experts shelf's age. */
export function ageText(iso: string, now: number): string {
  const days = Math.floor((now - new Date(iso).getTime()) / 86_400_000)
  if (days < 1) return 'today'
  if (days < 7) return `${days}d ago`
  if (days < 30) return `${Math.floor(days / 7)}w ago`
  return `${Math.floor(days / 30)}mo ago`
}
