/**
 * Who may edit and save a custom scoring system.
 *
 * Custom scoring was Pro-only (CLAUDE.md business rule 6). That rule is ON
 * HOLD (Chris, 2026-10-16: "yes open up custom scoring too" — the Pro logic
 * is on hold for the free-only launch), so every signed-in account can tune
 * the values and save a system of its own. The check stays in place behind
 * this switch rather than being removed (CLAUDE.md: keep the is_pro checks);
 * a Pro tier brings the gate back by setting it to true.
 *
 * The save route (`/api/scoring-systems`) is the enforcement point and reads
 * the same switch, so the settings page and the server can never disagree.
 */
export const CUSTOM_SCORING_PRO_ONLY = false

/** Can this account edit and save a custom scoring system? */
export function canCustomizeScoring(isPro: boolean): boolean {
  return !CUSTOM_SCORING_PRO_ONLY || isPro
}
