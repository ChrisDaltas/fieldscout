/**
 * The corrections read's named sentences, in a module with no imports so the
 * browser hook can match them without bundling the server service
 * (M6 L.E2.3; R1350 — the hook treats a 503 as "not pushed yet" only when it
 * is THIS sentence).
 */

/** The deploy-before-push answer (503): the database predates migration 172. */
export const CORRECTIONS_UNAVAILABLE_MESSAGE =
  'Stat corrections aren’t available yet — the league database hasn’t been updated for them. Try again after the next update.'
