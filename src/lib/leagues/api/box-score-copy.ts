/**
 * The box-score read's `stored_note` sentences (M5 L.D3.11 / migration 158,
 * PROGRESS D422), in a module with no imports so the browser can match them
 * without bundling the server service — the `corrections-copy.ts` precedent
 * (R1350). `box-score-service.ts` sends them verbatim; the matchup view
 * (`corrections-view-ops.ts` `boxPointsNote`, M6 L.E2.4 / F477) renders each
 * in a member's words. Moved here unchanged — the text the API sends is the
 * text `stored-player-points-db.test.ts` pins.
 */

export const BOX_NONE_STORED_NOTE =
  'no per-player points are stored for this team-week (it was scored before they were, and the one-time backfill has not reached it) — the lines are computed from today’s stats and may not add up to the final score'
export const BOX_OVERRIDDEN_NOTE =
  'the commissioner set this team’s score for the week, so these player points (what the team was scored on) do not add up to it'
export const BOX_NO_GAME_NOTE =
  'this team has no game this week, so no points were stored for it — the lines are computed from today’s stats'
export const BOX_UNRECOVERABLE_NOTE =
  'a stat correction reached a player after this week was scored, and the line he was scored on no longer exists — these points are recomputed from the corrected stats and do not add up to the final score'
