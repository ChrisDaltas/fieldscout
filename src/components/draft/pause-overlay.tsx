/**
 * The paused board treatment — VISUAL ONLY since DR.7 (D155; spec §16.3
 * "say a thing once"; §16.5.4's v2.12 note: inside the room, the command
 * bar is the banner surface and the board overlay must not retell what it
 * announces).
 *
 * The M2 overlay narrated the pause — a Paused badge, "Draft paused" /
 * "Practice paused" copy, the frozen-remaining-time line, the chat
 * attribution / 72h-expiry note, and a Resume button. Every one of those
 * voices now lives elsewhere, exactly once:
 *   - the state in words → the bar's `role="status"` line ("Draft paused";
 *     `command-bar-ops.ts`);
 *   - the frozen remaining time → the strip's `PickClock` paused mode
 *     (kept deliberately — D155);
 *   - WHO paused → the D97 system post in draft chat (unchanged);
 *   - the mock 72h-expiry note → its §16.5.2 homes (the practice
 *     launcher's `mock-launcher-ops.ts` line and `exitDraftCopy`'s mock
 *     arm);
 *   - Resume → the bar's button, for whoever may legally call it
 *     (commissioner on a real draft; the LAUNCHER on a mock — R272; the
 *     predicate is `command-bar-ops.ts`'s `canPauseResume` derivation).
 *
 * What remains here is what a paused BOARD looks like: dimmed and
 * non-interactive — this layer sits over the board card and stops pointer
 * events at itself, while the chrome (bar, strip, dock) stays live above
 * and below it. `aria-hidden` because the bar's status line is the one
 * assistive announcement of the pause; the M2 overlay's `role="status"`
 * was a second one. Both halves are pinned in `one-voice.test.ts`.
 *
 * Elevation: nothing here rests elevated — the M2 card's "true overlay"
 * exception retired with the card (CLAUDE.md elevation rule; a bare dim
 * layer casts no shadow).
 */
export function DraftPauseOverlay() {
  return <div aria-hidden="true" className="absolute inset-0 z-10 rounded-sm bg-white/80" />
}
