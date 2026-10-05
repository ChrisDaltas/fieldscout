/**
 * Projected points are ALWAYS dark blue, site-wide (D497, Chris 2026-10-05),
 * so a projection can never be mistaken for points actually scored — those
 * keep the ink colour. The token is the existing `fs-blue-deep` (#0060C0).
 *
 * THE one mechanism: every projected-points value applies `PROJ_TEXT` (via
 * `cn`). Never write the colour class at a call site —
 * `projected-points.test.ts` pins each projected-points surface to this
 * import.
 */
export const PROJ_TEXT = 'text-fs-blue-deep'
