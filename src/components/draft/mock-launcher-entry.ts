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

/**
 * Where a STANDALONE practice draft's room lives (MP.6; spec v2.16 §8.8).
 *
 * The league arm above is unchanged and stays league-side: a league-attached
 * mock is still `…/draft?draft=<id>` on its own league's room route, because
 * that is where the room mounts (MP.6 is the route and only the route —
 * D243). This is the other arm, and it is a different URL rather than a
 * widened one because a standalone mock has no league id to put in the
 * league one.
 *
 * Keyed on the MOCK's id, under `(room)/mocks/`'s `mockDrafts` gate — the
 * `/app/leagues` URL space is redirected away wholesale when the leagues
 * flag is off (R470 / D231(3a)), which is the defect this route exists to
 * escape.
 */
export function mockRoomHref(mockId: string): string {
  return `/app/mocks/${mockId}`
}
