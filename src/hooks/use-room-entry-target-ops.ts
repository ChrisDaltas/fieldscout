/**
 * The entry split's pure half (spec §16.1 v2.12; tasks-DR DR.6 item 1):
 * in-app entry into the draft room opens a **new browser tab on desktop**
 * and **in place on mobile** ("a new tab on a phone is hostile — the user
 * cannot find their way back").
 *
 * The desktop/mobile decision is media-query state, NEVER user-agent
 * sniffing (the banner's explicit rule): desktop means a `lg`-wide viewport
 * (1024px — the room's own single breakpoint) AND a non-coarse pointer, so
 * a touch tablet at desktop width still gets the in-place treatment its
 * pointer model wants. `null` is the SSR/pre-mount state and defaults to
 * SAME TAB — the split upgrades on mount, so no-JS, hydration, and
 * middle-click all behave (a real anchor either way).
 */

/** The `lg` breakpoint — the app's desktop boundary (tailwind default). */
export const ROOM_ENTRY_DESKTOP_QUERY = '(min-width: 1024px)'

/** Touch-primary devices enter in place regardless of viewport width. */
export const ROOM_ENTRY_COARSE_QUERY = '(pointer: coarse)'

/** Anchor props for a room-entry link. Spread onto the `<Link>`/anchor —
 *  empty means the browser's default same-tab navigation. */
export interface RoomEntryTargetProps {
  target?: '_blank'
  /** The new-tab arm always severs the opener (the banner's rule). */
  rel?: 'noopener'
}

/**
 * `null` (SSR / not yet measured) and `false` (mobile / coarse pointer)
 * both mean same-tab; only a measured desktop upgrades to the new-tab arm,
 * and that arm always carries `rel="noopener"`.
 */
export function roomEntryTargetProps(desktopFinePointer: boolean | null): RoomEntryTargetProps {
  if (desktopFinePointer !== true) return {}
  return { target: '_blank', rel: 'noopener' }
}
