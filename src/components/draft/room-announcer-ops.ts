/**
 * Room announcer copy (spec §16.3: "Accessible to WCAG 2.1 AA (… live-region
 * announcements for picks/clock …)"; M7 task L.F1.1, PROGRESS F55, D620).
 *
 * The room SHOWS every pick and the clock, but until L.F1.1 nothing TOLD a
 * screen-reader user that a pick had landed or that the clock had moved to
 * them — the only live regions were the bar's paused/live line and the
 * auction's anti-snipe flash. `room-announcer.tsx` renders the sentences
 * built here into polite, visually hidden live regions.
 *
 * Pure and colocated (the command-bar-ops / status-strip-ops precedent: a
 * plain `.ts` so vitest can import it under `jsx: "preserve"`), pinned by
 * literal goldens in `room-announcer-ops.test.ts`.
 *
 * What is NOT announced here, and why (§16.3 say-a-thing-once):
 *   - paused / live — the command bar's `role="status"` line already says it;
 *   - reconnecting / stale — the bar's banners are their own live regions;
 *   - the auction's high bid — `auction-block.tsx` owns that sentence, next to
 *     the number it reads.
 */

/** Warnings fire once each as the viewer's OWN clock crosses them. */
export const CLOCK_WARNING_THRESHOLDS_MS = [30_000, 10_000] as const

export interface PickAnnouncementInput {
  /** `pickLabel(pick_number, teamCount)` — e.g. `3.07`. */
  pickLabel: string
  teamName: string
  playerName: string
  position: string | null
  /** Auction awards carry the price; snake picks pass null. */
  price: number | null
  isAuction: boolean
}

/** One made pick (snake) or award (auction), as a sentence. */
export function pickAnnouncement(input: PickAnnouncementInput): string {
  const who = input.position ? `${input.playerName}, ${input.position}` : input.playerName
  if (input.isAuction) {
    // "Chase, WR, for $61" — the position is an aside, so it closes with a
    // comma before the price; with no position there is nothing to close.
    const price =
      input.price === null ? '' : `${input.position ? ',' : ''} for $${input.price}`
    return `${input.teamName} wins ${who}${price}.`
  }
  return `Pick ${input.pickLabel}: ${input.teamName} takes ${who}.`
}

export interface OnClockAnnouncementInput {
  youAreOnClock: boolean
  onClockTeamName: string | null
  isAuction: boolean
}

/**
 * Whose turn it is. In an auction the team "on the clock" is the one
 * NOMINATING (`drafts.on_clock_team_id` — 085/087), so the words say that.
 * Empty when the room cannot name the team (a live region with nothing true
 * to say stays quiet rather than saying "a team").
 */
export function onClockAnnouncement(input: OnClockAnnouncementInput): string {
  if (input.isAuction) {
    if (input.youAreOnClock) return 'Your turn to nominate.'
    return input.onClockTeamName ? `${input.onClockTeamName} is nominating.` : ''
  }
  if (input.youAreOnClock) return "You're on the clock."
  return input.onClockTeamName ? `On the clock: ${input.onClockTeamName}.` : ''
}

/**
 * One sentence for a gathered beat: what just happened, THEN whose turn it
 * is — the order they happened in, whichever render delivered them first.
 * Either half may be absent (a turn change with no pick — a resume, an
 * order edit; a pick whose next turn has not landed yet).
 */
export function composeTurnAnnouncement(pick: string | null, turn: string | null): string {
  return [pick, turn].filter((part): part is string => Boolean(part)).join(' ')
}

/**
 * The threshold the viewer's clock just crossed, or null. A crossing is
 * `previous > threshold >= current`; when one sample jumps past both (a
 * backgrounded tab), only the LOWEST crossed threshold is returned — the
 * stale warning would be a lie about how much time is left.
 */
export function crossedClockWarning(
  previousRemainingMs: number | null,
  remainingMs: number | null,
): number | null {
  if (previousRemainingMs === null || remainingMs === null) return null
  let crossed: number | null = null
  for (const threshold of CLOCK_WARNING_THRESHOLDS_MS) {
    if (previousRemainingMs > threshold && remainingMs <= threshold && remainingMs > 0) {
      crossed = crossed === null ? threshold : Math.min(crossed, threshold)
    }
  }
  return crossed
}

/** The warning sentence for a crossed threshold. */
export function clockWarningAnnouncement(thresholdMs: number, isAuction: boolean): string {
  const seconds = Math.round(thresholdMs / 1000)
  return isAuction
    ? `${seconds} seconds left to nominate.`
    : `${seconds} seconds left on your pick.`
}

export interface HighBidAnnouncementInput {
  amount: number
  teamName: string | null
  playerName: string | null
  /** The bid is the viewer's own seat's (or the seat they act for). */
  isMine: boolean
}

/** The auction's one-glance fact (§16.3) — who holds the high bid, at what. */
export function highBidAnnouncement(input: HighBidAnnouncementInput): string {
  const on = input.playerName ? ` on ${input.playerName}` : ''
  if (input.isMine) return `You hold the high bid${on} at $${input.amount}.`
  const who = input.teamName ?? 'Another team'
  return `High bid${on}: $${input.amount}, ${who}.`
}
