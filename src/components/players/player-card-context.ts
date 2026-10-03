/**
 * Where a player card was opened from (League UX batch 2 — Chris 2026-10-03:
 * every player mention opens the card, and roster actions are reachable from
 * the player). The context decides the card's actions block:
 *
 * - `global`  — research surfaces: an "Available in N leagues" expander.
 * - `league`  — a league page: where he is in THAT league and the one move
 *               that fits (Add / Claim / Bid, Drop, Propose trade).
 * - `draft`   — the draft room: a Queue (Targets) button for the seat.
 */
export type PlayerCardContext =
  | { kind: 'global' }
  | { kind: 'league'; leagueId: string }
  | { kind: 'draft'; leagueId: string | null; draftId: string; teamId: string | null }

export const GLOBAL_CARD_CONTEXT: PlayerCardContext = { kind: 'global' }

export function leagueCardContext(leagueId: string): PlayerCardContext {
  return { kind: 'league', leagueId }
}
