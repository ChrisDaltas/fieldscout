/**
 * Entry seam for the §16.2 `mock-draft-launcher` (spec §8.8; tasks-M2
 * L.B3.5). L.B3.4 wired the "Practice this draft" CTAs to THIS seam behind a
 * ready-flag so the UI lane order couldn't dead-end; L.B3.5 mounted the
 * launcher at `mockLauncherHref`'s destination and flipped the flag in the
 * same PR — the CTAs went live with zero call-site rewiring (D120(9)).
 */

/** Flipped to true by L.B3.5 — the launcher surface exists. */
export const MOCK_LAUNCHER_READY = true

/**
 * Where "Practice this draft" goes once the launcher exists. `?practice=1`
 * on the draft-room route is the launcher entry (the room already owns
 * `?draft=<id>` as the mock-room path — the launcher lives beside it).
 */
export function mockLauncherHref(leagueId: string): string {
  return `/app/leagues/${leagueId}/draft?practice=1`
}
