/**
 * Residual league display helpers.
 *
 * This file once held the whole mock league workspace (leagues, matchups,
 * lineups, schedule, history, standings) that the "UI-only" league screens
 * rendered before the backend existed. M1 replaced those surfaces with real
 * data — the create wizard (L.A2.1), settings panel (L.A2.4), invite panel
 * (L.A2.5), join page (L.A2.6), and the league-home state machine (L.A2.7,
 * this shrink). The mock workspace + its in-season tabs were deleted with the
 * home rewire; the real in-season screens (lineup-editor, matchup-view, …) are
 * M4 and carry their own names (spec §16.2).
 *
 * What remains is the pieces `league-cells.tsx` still shares: the `initialsOf`
 * crest helper and the two lineup-cell types its generic `PlayerCell` /
 * `StatusTag` accept. (Draft mocks live separately in `src/components/draft/`
 * and are untouched — M2.)
 */

/** Injury designation used by the shared `StatusTag` cell. */
export type MockInjuryStatus = '' | 'Q' | 'O' | 'D'

/** A rostered player in a lineup slot — the shape the shared `PlayerCell` reads. */
export interface MockLineupPlayer {
  slot: string
  name: string
  pos: string
  team: string
  /** "@MIA" / "vs CAR" */
  opp: string
  /** Kickoff, e.g. "Sun 1:00". */
  time: string
  proj: number
  /** Opponent positional rank (1 = toughest matchup). */
  oprk: number
  status: MockInjuryStatus
}

/** First one or two initials of a name, uppercased — the crest fallback glyph. */
export function initialsOf(name: string): string {
  const letters = name
    .split(/\s+/)
    .map((word) => word[0] ?? '')
    .join('')
    .replace(/[^A-Za-z]/g, '')
  return (letters.slice(0, 2) || '?').toUpperCase()
}
