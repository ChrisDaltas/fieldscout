/**
 * Entry seam for the §16.2 `mock-draft-launcher` (spec §8.8; tasks-M2
 * L.B3.5). L.B3.4 wires the "Practice this draft" CTAs to THIS seam behind a
 * ready-flag so the UI lane order can't dead-end: the launcher itself is
 * L.B3.5's deliverable, and until it exists the CTA renders visibly present
 * but honestly disabled (the F38 StubbedCta treatment, now scoped to exactly
 * the one missing surface). L.B3.5 flips `MOCK_LAUNCHER_READY` to true in the
 * same PR that mounts the launcher at `mockLauncherHref`'s destination —
 * nothing else to rewire.
 */

/** Flipped to true by L.B3.5 when the launcher surface exists. */
export const MOCK_LAUNCHER_READY = false

/**
 * Where "Practice this draft" goes once the launcher exists. `?practice=1`
 * on the draft-room route is the launcher entry (the room already owns
 * `?draft=<id>` as the mock-room path — the launcher lives beside it).
 */
export function mockLauncherHref(leagueId: string): string {
  return `/app/leagues/${leagueId}/draft?practice=1`
}
