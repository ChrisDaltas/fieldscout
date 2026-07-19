/**
 * TimeProvider — the single seam through which league-engine code reads time.
 *
 * Spec §23.1/§23.6 (virtual clock), M0 task L.A0.1, decisions D2/D3
 * (docs/specs/tasks-M0-foundations.md §3). Engine and worker code never calls
 * `Date.now()` or argless `new Date()` directly — it receives a TimeProvider
 * and asks it. Cadences and deadlines are expressed in *virtual* time, so a
 * replay speed knob changes pacing, never behavior.
 */
export interface TimeProvider {
  now(): Date
}

/**
 * Wall clock. The ONLY sanctioned raw clock read in engine code (D3) — the
 * ESLint time-guard bans `Date.now()`/argless `new Date()` everywhere else
 * under src/lib/leagues/**.
 */
export const systemTime: TimeProvider = {
  // eslint-disable-next-line no-restricted-syntax -- the one sanctioned wall-clock read (D3)
  now: () => new Date(),
}
