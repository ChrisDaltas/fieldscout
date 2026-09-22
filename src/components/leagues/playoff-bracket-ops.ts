import type { StandingsRow } from '@/lib/leagues/api/standings-service'
import type {
  BracketGame,
  BracketRound,
  PlayoffBracket,
  PlayoffBracketDoc,
  ProjectionBasis,
} from '@/lib/leagues/api/playoffs-service'

import { formatInstantInZone } from './league-home-states-ops'
import { weekBadge, type WeekBadge } from './matchup-view-ops'

/**
 * Pure decisions for `playoff-bracket.tsx` (spec §16.2 `playoff-bracket`,
 * §11.5's Playoffs bullet v2.16.25 — Q39 (A)–(E); §16.4's timezone rule;
 * M4 task L.D5.5; PROGRESS D318, D326).
 *
 * **THE RULES THIS FILE KEEPS.** (1) The bracket is the engine's: every
 * seed, pairing, total, verdict and instant here is READ from 118's
 * document and LABELLED — nothing is re-derived (no client seeding, no
 * client tiebreak, no sum of two weeks — `home_total` / `away_total` are
 * 118's). (2) `rollover_at` / `corrections_close_at` are ONE absolute
 * instant per league (a stored `timestamptz`), rendered in the VIEWER'S
 * zone with the league zone on hover (§16.4) — NEVER the word "midnight",
 * never a fixed clock (Q39 (E): "for central and eastern timezones it's
 * already hours into Tuesday"); a NULL `rollover_at` names the EVENT
 * ("when Week N's last game ends" — F238's posture), not a clock. (3) No
 * clock is read (§23.3 / the F226 fence): every instant rendered is stored.
 * (4) No ledger code reaches end-user copy (F277(a)); § citations may.
 *
 * The DoD probe (render the rollover as "midnight" / through a fixed zone)
 * reds the timezone-render fixture in `playoff-bracket-ops.test.ts`.
 */

// ---------------------------------------------------------------------------
// The document's shape → what the view shows
// ---------------------------------------------------------------------------

export type BracketShape = 'points_race' | 'no_playoffs' | 'projected' | 'awaiting_build' | 'bracket'

/**
 * Which surface the document asks for. `projected` while the regular
 * season is still in play and round 1 is not written; `awaiting_build`
 * when the regular season has ROLLED (every regular week closed) but the
 * read still finds no round-1 rows — the hourly sync has not written it
 * yet (a pending score holds it by name — R840 — or a foreign row blocks
 * it — D318(5) — or the job has simply not run since the rollover); the
 * read model cannot tell those apart and the copy does not pretend to.
 */
export function bracketShape(doc: PlayoffBracket): BracketShape {
  if (doc.kind !== 'bracket') return doc.kind
  if (doc.view === 'projected') return doc.regular_season_rolled ? 'awaiting_build' : 'projected'
  return 'bracket'
}

/** Round 1 (or the regular season for the no-bracket kinds) is the only
 *  round whose "foreign rows" can hold a build BEFORE anything is written;
 *  the document carries the count on the round. */
export function foreignRowsOf(doc: PlayoffBracket): number {
  if (doc.kind !== 'bracket') return 0
  return doc.round_list.reduce((n, r) => n + (r.foreign_rows ?? 0), 0)
}

// ---------------------------------------------------------------------------
// Copy — designed, by reason (§16.5.4), no ledger codes (F277(a))
// ---------------------------------------------------------------------------

export const PROJECTED_TITLE = 'If the playoffs started today'
export const BUILT_TITLE = 'The bracket'
export const POINTS_RACE_COPY =
  'A total-points league has no bracket — the season-long points race decides the champion.'
export const NO_PLAYOFFS_COPY = 'Playoffs are off for this league — the final standings decide the champion.'
export const AWAITING_BUILD_COPY =
  'The regular season is over and the bracket has not been written yet — it appears once every score of the final week is on record.'
export const NO_PROJECTION_NO_WEEKS_COPY =
  'No week has been played yet — the seeds follow the coin-flip order until results land.'
export const SEEDED_BEFORE_CORRECTION_COPY = 'Seeded before a late correction — stands as played.'
export const SEEDED_BEFORE_CORRECTION_TITLE =
  'The seeds frozen on this round differ from the final standings: a stat correction moved a rank after the round had been played, and a played round is never rewritten (§23.4).'
export const COMMISH_DOOR_PENDING_COPY =
  'Results are corrected on the matchup page — open the game there with override mode on. Every change is posted to the league’s audit log.'
export const TBD_LABEL = 'TBD'
export const ROLLOVER_EVENT_PREFIX = 'When Week'

/** The projection's basis line, from 118's `projection_basis`. `null` when
 *  there is no basis to name (a built bracket). */
export function projectionBasisCopy(basis: ProjectionBasis | null, playoffTeams: number): string | null {
  if (!basis) return null
  if (basis.seeded < playoffTeams) {
    return `Only ${basis.seeded} of ${playoffTeams} seats can be seeded yet — the projection appears once the standings can fill the bracket.`
  }
  if (basis.weeks_final === 0 && basis.weeks_projected === 0) return NO_PROJECTION_NO_WEEKS_COPY
  const final = `${basis.weeks_final} week${basis.weeks_final === 1 ? '' : 's'} final`
  const projected = `${basis.weeks_projected} projected as if ${basis.weeks_projected === 1 ? 'it' : 'they'} ended now`
  return `Based on ${final} and ${projected}.`
}

export function pointsRaceCopy(kind: 'points_race' | 'no_playoffs'): string {
  return kind === 'points_race' ? POINTS_RACE_COPY : NO_PLAYOFFS_COPY
}

/** D318(5): a playoff row with NO seed is not the engine's — the sync
 *  writes nothing until a human resolves it. Surfaced as a count. */
export function foreignRowsCopy(count: number): string | null {
  if (count <= 0) return null
  return count === 1
    ? '1 playoff pairing on record was not written by the engine — the bracket holds until the commissioner resolves it.'
    : `${count} playoff pairings on record were not written by the engine — the bracket holds until the commissioner resolves them.`
}

// ---------------------------------------------------------------------------
// Rounds — labels, badges, TBD slots
// ---------------------------------------------------------------------------

export function roundLabel(round: number, rounds: number): string {
  const fromEnd = rounds - round
  if (fromEnd === 0) return 'Championship'
  if (fromEnd === 1) return 'Semifinals'
  if (fromEnd === 2) return 'Quarterfinals'
  return `Round ${round}`
}

/** The §16.5.4 badge for a round: the LEAST-advanced of its weeks decides
 *  (a two-week round with week 1 final and week 2 live is "Live"); an
 *  unbuilt round wears no badge (a TBD slot is its own label). */
export function roundBadge(round: Pick<BracketRound, 'built' | 'weeks'>): WeekBadge | null {
  if (!round.built) return null
  const order = ['upcoming', 'live', 'correction_window', 'final']
  let least = 'final'
  for (const w of round.weeks) {
    if (order.indexOf(w.status) < order.indexOf(least)) least = w.status
  }
  return weekBadge(least)
}

/** F256(c): the projected read computes round 1 only; later rounds are
 *  TBD slots — `expected_games` of them, never an invented result. */
export function tbdSlots(round: Pick<BracketRound, 'expected_games'>): number {
  return Math.max(0, round.expected_games)
}

/** F256(a): `source` names whether the PRIOR stage is final NOW. */
export function sourceLabel(round: Pick<BracketRound, 'built' | 'source'>): string | null {
  if (!round.built || !round.source) return null
  return round.source === 'final' ? 'Seeded from final results' : 'Seeded provisionally — corrections may still move a seed'
}

// ---------------------------------------------------------------------------
// Games — the verdict in words (118's `decided_by`), never re-decided
// ---------------------------------------------------------------------------

export interface VerdictCopy {
  /** The chip. */
  label: string
  /** The hover explanation. */
  title: string
}

/** Q39 (A)/(B) as labels: `points` — the two-week sum (each week's row
 *  keeps its own W/L/T); `higher_seed` — an equal sum advances the higher
 *  seed with `result` left `tie`; `bye`. Tense follows `final`. */
export function verdictCopy(game: Pick<BracketGame, 'decided_by' | 'final' | 'weeks'>): VerdictCopy {
  const twoWeek = game.weeks.length > 1
  if (game.decided_by === 'bye') return { label: 'Bye', title: 'A top seed sits out round 1 (bracket size − playoff teams).' }
  if (game.decided_by === 'higher_seed') {
    return {
      label: game.final ? 'Tied — higher seed advances' : 'Tied — higher seed would advance',
      title: twoWeek
        ? 'The two-week totals are equal; the higher seed advances and each week keeps its own result.'
        : 'The scores are equal at two decimals; the higher seed advances and the game keeps its tie.',
    }
  }
  return {
    label: game.final ? 'Advances on points' : 'Leads on points',
    title: twoWeek ? 'The two weeks’ scores are added together; the most points over both weeks wins.' : 'The higher score advances.',
  }
}

/**
 * Has a game been PLAYED, by the rows' stored status: a round whose every
 * row is still `scheduled` (its week `upcoming`) has no score to show and
 * no verdict to name — 109's `DEFAULT 0` on an unscored row would otherwise
 * read as a 0–0 tie the higher seed "would" win (F273 / F257(a)'s hole, the
 * regular season's twin). Read from the status, never inferred from a 0.
 */
export function gamePlayed(game: Pick<BracketGame, 'weeks'>): boolean {
  return game.weeks.some((w) => w.status !== 'scheduled')
}

/** A stored score as text: NULL is the door's pending word (E61), never
 *  0.00; a `scheduled` row's cell is a dash (the schedule grid's spelling —
 *  nothing has been scored yet). */
export function formatBracketScore(score: number | null, status = 'live'): string {
  if (status === 'scheduled') return '—'
  return score === null ? 'pending' : score.toFixed(2)
}

export function formatTotal(total: number): string {
  return total.toFixed(2)
}

// ---------------------------------------------------------------------------
// R846 / F257(b′): a round seeded before a late correction
// ---------------------------------------------------------------------------

/**
 * The engine emits NO marker when a round's frozen seeds came from a
 * verdict that later moved; the view DERIVES it: the regular season is
 * FINAL, the round is built, and some frozen seed's team is not the team
 * the FINAL standings rank at that seed. Seeds are ORIGINAL seeds on every
 * round (118 rider (iii)), so the comparison holds for every built round.
 * `null` standings (not loaded) ⇒ never labelled — a label needs evidence.
 */
export function seededBeforeCorrection(
  doc: Pick<PlayoffBracketDoc, 'regular_season_final'>,
  round: Pick<BracketRound, 'built' | 'games'>,
  finalStandings: readonly Pick<StandingsRow, 'rank' | 'team_id'>[] | null,
): boolean {
  if (!doc.regular_season_final || !round.built || !finalStandings) return false
  const byRank = new Map(finalStandings.map((r) => [r.rank, r.team_id]))
  for (const g of round.games) {
    if (byRank.get(g.home_seed) !== g.home_team_id) return true
    if (g.away_team_id && g.away_seed !== null && byRank.get(g.away_seed) !== g.away_team_id) return true
  }
  return false
}

// ---------------------------------------------------------------------------
// The rollover — ONE absolute instant, rendered per viewer (§16.4 / Q39 (E))
// ---------------------------------------------------------------------------

export interface RolloverDisplay {
  /** What the viewer reads — their own zone, or the EVENT when unrecorded. */
  text: string
  /** The league zone's rendering, for hover; null when the league has no
   *  named zone or the instant is unrecorded. */
  title: string | null
  kind: 'instant' | 'event'
}

/**
 * Render a stored instant in a zone (the viewer's when `viewerZone` is
 * undefined — the browser's own; a NAMED zone in a test fixture) — weekday,
 * date and time, joined by hand from `formatToParts` so the output is
 * pinned to OUR separators regardless of ICU's joining. Returns null when
 * the zone is unusable. NOTHING here is a clock read: the instant is the
 * argument.
 */
export function formatInstantForViewer(iso: string, viewerZone?: string): string | null {
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return null
  let parts: Intl.DateTimeFormatPart[]
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone: viewerZone,
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).formatToParts(new Date(ms))
  } catch {
    return null
  }
  const get = (type: Intl.DateTimeFormatPart['type']) => parts.find((p) => p.type === type)?.value ?? null
  const weekday = get('weekday')
  const month = get('month')
  const day = get('day')
  const hour = get('hour')
  const minute = get('minute')
  const dayPeriod = get('dayPeriod')
  if (!weekday || !month || !day || !hour || !minute || !dayPeriod) return null
  return `${weekday}, ${month} ${day}, ${hour}:${minute} ${dayPeriod}`
}

/**
 * The rollover line. A recorded instant renders in the viewer's zone with
 * the league zone's full rendering (and its abbreviation) on hover; an
 * unrecorded one (`rollover_at` NULL — ingestion has not stamped the last
 * game's end, F238) names the EVENT: "When Week N's last game ends". No
 * "midnight", no fixed zone, no arithmetic — the instant is 118's.
 */
export function rolloverDisplay(
  doc: Pick<PlayoffBracket, 'rollover_week' | 'rollover_at'>,
  leagueZone: string | null,
  viewerZone?: string,
): RolloverDisplay {
  const week = doc.rollover_week ?? null
  if (!doc.rollover_at) {
    return {
      text: week === null ? 'When the last regular-season game ends' : `${ROLLOVER_EVENT_PREFIX} ${week}’s last game ends`,
      title: null,
      kind: 'event',
    }
  }
  const local = formatInstantForViewer(doc.rollover_at, viewerZone) ?? doc.rollover_at
  const ms = Date.parse(doc.rollover_at)
  const zoned = leagueZone && !Number.isNaN(ms) ? formatInstantInZone(ms, leagueZone) : null
  return {
    text: local,
    title: zoned ? `${zoned.text}${zoned.zoneAbbrev ? ` ${zoned.zoneAbbrev}` : ''} (league time)` : null,
    kind: 'instant',
  }
}

/** The correction close, the same way (a recorded calendar instant). */
export function correctionsCloseDisplay(
  doc: Pick<PlayoffBracket, 'corrections_close_at'>,
  leagueZone: string | null,
  viewerZone?: string,
): RolloverDisplay | null {
  if (!doc.corrections_close_at) return null
  return rolloverDisplay({ rollover_week: null, rollover_at: doc.corrections_close_at }, leagueZone, viewerZone)
}

// ---------------------------------------------------------------------------
// Commissioner doors — M6's `commish-action-modal`, pending by name
// ---------------------------------------------------------------------------

export interface CommishDoor {
  key: 'results'
  label: string
}

/** §10 / §16.2: "commish edit affordances (seeds/results) routed through
 *  commish-action-modal". The SEEDS door is REAL since M6A L.E1.16 — the
 *  hand-pick control (`bracket-hand-pick-panel.tsx`, `commish_edit_bracket`)
 *  — so it no longer renders as a pending door. The results door stays
 *  pending by name here: results are corrected on the matchup page
 *  (L.E1.12). A manager sees no door. */
export function commishDoors(myRole: string | null | undefined): CommishDoor[] {
  if (myRole !== 'commissioner') return []
  return [{ key: 'results', label: 'Edit a result' }]
}

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

export function teamName(names: ReadonlyMap<string, string>, teamId: string | null): string {
  if (!teamId) return TBD_LABEL
  return names.get(teamId) ?? 'Unknown team'
}
