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

/**
 * The same rule on the phone (gap list §4 item 15): the phone layout has a
 * dark mode, where the fixed #0060C0 would sit dim on the #121212 page. The
 * themed `m-proj` token is that same #0060C0 in light and the README's dark
 * blue text (#6FB5FF) in dark (globals.css). Phone components apply this one,
 * desktop ones `PROJ_TEXT`; neither class is written at a call site.
 */
export const M_PROJ_TEXT = 'text-m-proj'
