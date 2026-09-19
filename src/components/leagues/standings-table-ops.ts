import type { LeagueStandings, StandingsRow } from '@/lib/leagues/api/standings-service'

/**
 * Pure decisions for `standings-table.tsx` (spec §16.2 `standings-table`,
 * §7.3.7, §11.5 — M4 task L.D5.3; PROGRESS D297, D314, D317).
 *
 * **THE ONE RULE THIS FILE KEEPS: the order is the RPC's.** `league_standings`
 * (117) ranks the rows and names, per row, the chain entry that separated it
 * from the row above (`separated_by`); its `chain` document is the league's
 * stored tiebreaker order with each entry's status (`applied` / `skipped` /
 * `inert`) and reason (E63's 3+-team skip, E64's `total_points` skip, the
 * Q30 inert division entry). This file LABELS those — it never re-sorts a
 * row, never re-derives a separator, never reorders the chain. The DoD
 * probe (render PA before H2H) reds the chain-order fixture in
 * `standings-table-ops.test.ts` and the render pin, because both assert
 * the STORED order. Points Against is rendered as 117 defines it (Q38 —
 * OPEN; a definition the spec lacks is a question, never an annotation,
 * R801).
 *
 * No clock here: the standings carry no instant a viewer needs.
 */

/** §7.3.7's catalog, one label each. Unknown entries render their key (117
 *  refuses an unknown tiebreaker by name, so this is defence only). */
export const TIEBREAKER_LABELS: Record<string, string> = {
  win_pct: 'Win %',
  points_for: 'PF',
  head_to_head: 'H2H',
  points_against: 'PA',
  division_record: 'Division',
  coin_flip: 'Coin flip',
}

export function tiebreakerLabel(entry: string): string {
  return TIEBREAKER_LABELS[entry] ?? entry
}

/** One entry of 117's `chain` document, as rendered. */
export interface RenderedChainEntry {
  entry: string
  label: string
  status: 'applied' | 'skipped' | 'inert'
  /** 117's reason for a skipped/inert entry, in words; null when applied. */
  note: string | null
}

const CHAIN_NOTES: Record<string, string> = {
  clean_two_team_ties_only: 'clean two-team ties only (E63)',
  total_points: 'skipped — a total-points league has no head-to-head (E64)',
  divisions_pinned_at_1: 'inert — divisions are off in v1',
}

function chainStatus(raw: unknown): RenderedChainEntry['status'] {
  return raw === 'skipped' || raw === 'inert' ? raw : 'applied'
}

/**
 * The chain, IN STORED ORDER, labelled. Accepts 117's `chain` (an array of
 * `{ entry, status, reason }`) and returns one rendered entry per element in
 * the same position. Anything that is not such an array renders as an empty
 * chain — the table still renders its rows (the RPC ranked them).
 */
export function renderedChain(chain: unknown): RenderedChainEntry[] {
  if (!Array.isArray(chain)) return []
  const out: RenderedChainEntry[] = []
  for (const raw of chain) {
    if (!raw || typeof raw !== 'object') continue
    const entry = String((raw as { entry?: unknown }).entry ?? '')
    if (!entry) continue
    const status = chainStatus((raw as { status?: unknown }).status)
    const reason = (raw as { reason?: unknown }).reason
    const note =
      status === 'applied'
        ? null
        : typeof reason === 'string'
          ? (CHAIN_NOTES[reason] ?? reason)
          : status
    out.push({ entry, label: tiebreakerLabel(entry), status, note })
  }
  return out
}

/** The per-row separator chip: the entry that placed this row below the one
 *  above it — null for the leader, "unresolved" only if 117 could not name
 *  one (it appends `coin_flip`, so this is defence). */
export function separatorLabel(separatedBy: string | null | undefined): string | null {
  if (!separatedBy) return null
  if (separatedBy === 'unresolved') return 'unresolved'
  return tiebreakerLabel(separatedBy)
}

/** "5-2" / "5-2-1" — ties only when there are any (§16.5.3's chips). */
export function formatRecord(record: { wins: number; losses: number; ties: number }): string {
  const base = `${record.wins}-${record.losses}`
  return record.ties > 0 ? `${base}-${record.ties}` : base
}

/** `.500` / `1.000` — the league's own rounding (117 rounds to 4). */
export function formatWinPct(winPct: number): string {
  return winPct >= 1 ? '1.000' : winPct.toFixed(3).replace(/^0/, '')
}

export function formatPoints(points: number): string {
  return points.toFixed(2)
}

/**
 * Which extra-record columns the table shows (§16.5.3): the median column
 * when the league plays the median game, the second-opponent column when it
 * has a second opponent — from the SETTINGS, so a league that turned a mode
 * on mid-season still shows the column over its zeros rather than hiding a
 * result that exists. A row carrying a non-empty record for a mode the
 * settings say is off shows it anyway: the RPC's record is the truth.
 */
export function recordColumns(
  rows: readonly StandingsRow[],
  settings: { median_game: boolean; second_opponent: boolean },
): { median: boolean; second: boolean } {
  const has = (pick: (r: StandingsRow) => { wins: number; losses: number; ties: number }) =>
    rows.some((r) => {
      const rec = pick(r)
      return rec.wins + rec.losses + rec.ties > 0
    })
  return {
    median: settings.median_game || has((r) => r.median_record),
    second: settings.second_opponent || has((r) => r.second_record),
  }
}

/** The empty state is BY REASON (rule 10): 117 says `no_final_weeks` and the
 *  table says why, never "no rows" inferred from `standings.length`. */
export const NO_FINAL_WEEKS_COPY =
  'No week is final yet — the table fills in when the first week finalizes.'

export function standingsEmptyCopy(doc: Pick<LeagueStandings, 'reason' | 'weeks_final'>): string | null {
  if (doc.reason === 'no_final_weeks') return NO_FINAL_WEEKS_COPY
  return null
}

/** E63/E64's named skips, in words, for the footnote. */
export function skipNotes(skipped: unknown, teamNames: ReadonlyMap<string, string>): string[] {
  if (!Array.isArray(skipped)) return []
  const notes: string[] = []
  for (const raw of skipped) {
    if (!raw || typeof raw !== 'object') continue
    const reason = (raw as { reason?: unknown }).reason
    const teams = (raw as { teams?: unknown }).teams
    const names = Array.isArray(teams)
      ? teams.map((t) => teamNames.get(String(t)) ?? String(t)).join(', ')
      : ''
    if (reason === 'group_of_3_or_more') {
      notes.push(`Head-to-head skipped for a tie of three or more (E63): ${names}.`)
    } else if (reason === 'total_points') {
      notes.push(`Head-to-head does not apply in a total-points league (E64)${names ? `: ${names}` : ''}.`)
    }
  }
  return notes
}

/** The projected view's line (L.D5.5 — 118's `league_standings_projected`,
 *  the SAME chain over every open regular-season week "as if it ended now";
 *  D318(3)). The final table's dependency this once named (F253(a)) is
 *  discharged: the control reads live data. */
export const PROJECTED_COPY =
  'Projected: every open week is counted as if it ended now — the same tiebreaker chain over provisional scores. Results go official when the week finalizes.'

// ---------------------------------------------------------------------------
// The commissioner-adjusted marker (M6A L.E1.12 — `matchups.is_overridden`)
// ---------------------------------------------------------------------------

/** The slice of a schedule row the marker reads — `useSchedule`'s rows. */
export interface OverriddenMatchupSlice {
  week: number
  round_type: string
  home_team_id: string
  away_team_id: string | null
  is_overridden: boolean
}

export const STANDINGS_OVERRIDDEN_MARK = '✸'
export const STANDINGS_OVERRIDDEN_LEGEND =
  '✸ A commissioner set the score or result of at least one of this team’s matchups. Open that week’s matchup to see it.'
/** Loud, not silent: if the flag could not be READ, an absent ✸ means
 *  "unknown", never "no overrides" (CLAUDE.md — assert the reason for
 *  emptiness). */
export const STANDINGS_OVERRIDES_UNKNOWN_COPY =
  'Couldn’t check for commissioner-adjusted matchups — a ✸ marker may be missing from this table.'

/**
 * `team_id → the weeks` in which a matchup of theirs carries
 * `is_overridden` (sorted, unique). The flag is one boolean on the ROW (D342),
 * so BOTH sides of an overridden matchup are marked. Playoff rows are left
 * out: they feed the bracket, not this table (§11.5 — the standings are the
 * regular season's); regular and `secondary` rows both feed its columns.
 * Reads the stored flag and nothing else — no score is compared, nothing is
 * inferred from a number looking "edited".
 */
export function overriddenWeeksByTeam(matchups: readonly OverriddenMatchupSlice[]): Map<string, number[]> {
  const weeks = new Map<string, Set<number>>()
  for (const m of matchups) {
    if (m.is_overridden !== true || m.round_type === 'playoff') continue
    for (const teamId of [m.home_team_id, m.away_team_id]) {
      if (!teamId) continue
      const set = weeks.get(teamId) ?? new Set<number>()
      set.add(m.week)
      weeks.set(teamId, set)
    }
  }
  return new Map([...weeks.entries()].map(([teamId, set]) => [teamId, [...set].sort((a, b) => a - b)]))
}

/** The marker's words — its `title` and its screen-reader text. */
export function overriddenTitle(weeks: readonly number[]): string {
  const list = weeks.map((w) => `Week ${w}`).join(', ')
  return `Commissioner-adjusted — the score or result of this team’s ${list} matchup${weeks.length === 1 ? '' : 's'} was set by the commissioner.`
}
