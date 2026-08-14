/**
 * Draft-recap derivations (M2 task L.B3.5; spec §8.8 "a finished mock keeps
 * a recap (full board + your roster vs. the CPUs')", §16.1 `/draft/recap` —
 * "real & mock: final board + rosters"; D103). Pure — colocated ops split.
 *
 * THE roster source is `draft_picks`, for BOTH variants, deliberately:
 * a completed REAL draft also populates `league_rosters` (072/D88), but a
 * completed MOCK bypasses that table entirely (§8.8 zero side effects —
 * D103), so the picks sheet is the one source the two recaps share. The
 * member RLS SELECT covers both. Undone picks are audit history (§12.4) and
 * never appear on a recap roster — E4's pool-return, final-board edition.
 */

import type { DraftPickSummary } from '@/hooks/use-draft'
import type { Draft } from '@/types/database'

// ---------------------------------------------------------------------------
// Variant resolution (mock vs real; the delete affordance is launcher-only)
// ---------------------------------------------------------------------------

export type RecapVariant =
  | {
      kind: 'mock'
      /** The practice seat (`config.mock.human_team_id` — D103(2)); null on
       *  a malformed config (render every roster undifferentiated). */
      humanTeamId: string | null
      /** §8.8: the recap's delete belongs to the LAUNCHER alone (the RPC
       *  refuses everyone else — the UI must not offer it more widely). */
      canDelete: boolean
    }
  | {
      kind: 'real'
      /** The viewer's franchise (leads the roster list); null for a
       *  seatless viewer (co-owners, departed managers, commissioners). */
      myTeamId: string | null
    }

/** Resolve which recap this draft renders for this viewer. */
export function recapVariant(
  draft: Pick<Draft, 'is_mock' | 'config'>,
  userId: string | null,
  myMemberTeamId: string | null,
): RecapVariant {
  if (!draft.is_mock) return { kind: 'real', myTeamId: myMemberTeamId }
  const config = draft.config as {
    mock?: { human_team_id?: string; launched_by?: string }
  } | null
  const mock = config?.mock ?? null
  return {
    kind: 'mock',
    humanTeamId: mock?.human_team_id ?? null,
    canDelete: Boolean(mock?.launched_by && userId && mock.launched_by === userId),
  }
}

// ---------------------------------------------------------------------------
// Rosters from the picks sheet (the shared derivation — both variants)
// ---------------------------------------------------------------------------

export interface RecapRoster {
  teamId: string
  /** This team's LIVE picks, ascending by pick number. */
  picks: DraftPickSummary[]
}

/**
 * Per-team rosters derived from `draft_picks` — non-undone rows only,
 * ascending by pick number within each team. NEVER `league_rosters` (a mock
 * has none to read — D103; one derivation serves both variants).
 */
export function recapRostersFromPicks(
  picks: readonly DraftPickSummary[],
): Map<string, DraftPickSummary[]> {
  const byTeam = new Map<string, DraftPickSummary[]>()
  for (const pick of picks) {
    if (pick.is_undone) continue // audit history — reverted, never rostered
    const roster = byTeam.get(pick.team_id)
    if (roster) roster.push(pick)
    else byTeam.set(pick.team_id, [pick])
  }
  for (const roster of byTeam.values()) {
    roster.sort((a, b) => a.pick_number - b.pick_number)
  }
  return byTeam
}

/**
 * The roster-section team order: the stored draft order, with the viewer's
 * anchor seat FIRST — the mock's human seat ("your roster vs the CPUs'",
 * §8.8) or the real viewer's own franchise. Teams that only appear in picks
 * (a defensive arm — e.g. an order the parser rejected) append after, so no
 * roster silently drops.
 */
export function recapTeamOrder(
  order: readonly string[],
  rosters: ReadonlyMap<string, DraftPickSummary[]>,
  anchorTeamId: string | null,
): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  const push = (teamId: string) => {
    if (!seen.has(teamId)) {
      seen.add(teamId)
      result.push(teamId)
    }
  }
  if (anchorTeamId) push(anchorTeamId)
  for (const teamId of order) push(teamId)
  for (const teamId of rosters.keys()) push(teamId)
  return result
}
