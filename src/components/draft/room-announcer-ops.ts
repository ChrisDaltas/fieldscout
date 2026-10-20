/**
 * Room announcer copy (spec §16.3: "Accessible to WCAG 2.1 AA (… live-region
 * announcements for picks/clock …)"; M7 task L.F1.1, PROGRESS F55, D620).
 *
 * The room SHOWS every pick and the clock, but until L.F1.1 nothing TOLD a
 * screen-reader user that a pick had landed or that the clock had moved to
 * them. The live regions that existed (the bar's paused/live line, its
 * reconnecting and stale banners, the auction's anti-snipe re-arm and the
 * §8.6.9 uncontested beat) each say a STATE; none says a pick or a turn.
 * `room-announcer.tsx` renders the sentences built here into polite,
 * visually hidden live regions.
 *
 * Pure and colocated (the command-bar-ops / status-strip-ops precedent: a
 * plain `.ts` so vitest can import it under `jsx: "preserve"`). The copy is
 * pinned by literal goldens in `room-a11y.render.test.ts`; the decision
 * machine below (`RoomAnnouncerMachine`) by fake-timer sequences in
 * `room-announcer-machine.test.ts` (R1635).
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

// ---------------------------------------------------------------------------
// The decision machine (R1630 / R1631 / R1635)
// ---------------------------------------------------------------------------

/**
 * How long the machine waits to gather a pick and the turn it hands over.
 * The picks broadcast and the drafts-row update arrive as separate renders
 * (measured live in L.F1.1: the turn landed BEFORE the pick that caused it).
 * Gathering them for a beat lets ONE sentence say them in the order they
 * happened. Presentation only — it decides nothing about the draft.
 */
export const ANNOUNCE_GATHER_MS = 600

export interface AnnouncedPick extends PickAnnouncementInput {
  /** `${pick_number}:${player_id}` — an undo followed by a different player
   *  at the same number is still news. */
  key: string
  pickNumber: number
}

export interface AnnouncerInput {
  /** The newest live pick, or null before the first. */
  latestPick: AnnouncedPick | null
  /** False while the newest pick's player identity is still loading: the
   *  machine WAITS rather than reading a player id aloud. */
  latestPickReady: boolean
  youAreOnClock: boolean
  /** `${current_pick_number}:${on_clock_team_id}` — the snake wrap (the same
   *  team twice running) is still a new turn. */
  onClockKey: string | null
  onClockTeamName: string | null
  isAuction: boolean
  /** Auction only: a nomination is up for bid. The deadline is then the BID
   *  window, which is everyone's and is re-armed by anti-snipe — not the
   *  viewer's own clock — so no own-clock warning runs (R1630). */
  nominationLive: boolean
}

export interface AnnouncerTimers {
  setTimeout: (fn: () => void, ms: number) => unknown
  clearTimeout: (handle: unknown) => void
}

/**
 * Everything the announcer DECIDES, outside React so it can be driven with
 * fake timers (R1635). `room-announcer.tsx` feeds it every render's inputs
 * (`update`) and a 500ms clock sample (`sampleClock`), and renders what it
 * says.
 *
 *   - Nothing is said on the first `update` — the room on load is a state.
 *   - A pick is said only when it is NEWER than the last one said: the
 *     newest pick number must be at least the last announced number (R1631).
 *     After an undo the newest pick is an older one already told, so the
 *     machine re-bases silently on it; the turn change it causes is still
 *     said, because whose turn it is did change.
 *   - Own-clock warnings fire at most once per threshold per TURN (R1630):
 *     a deadline that moves inside one turn (an edit, a resume) cannot make
 *     the same warning repeat. In an auction they run only while no
 *     nomination is live — i.e. the viewer's own nominating clock.
 */
export class RoomAnnouncerMachine {
  private initialised = false
  private lastPickKey: string | null = null
  private lastPickNumber = 0
  private lastTurnKey: string | null = null
  private pending: { pick: string | null; turn: string | null } = { pick: null, turn: null }
  private gatherHandle: unknown = null
  private input: AnnouncerInput | null = null
  private warnedTurnKey: string | null = null
  private warned = new Set<number>()
  private previousRemainingMs: number | null = null

  constructor(
    private readonly timers: AnnouncerTimers,
    private readonly sayTurn: (sentence: string) => void,
    private readonly sayClock: (sentence: string) => void,
  ) {}

  update(input: AnnouncerInput): void {
    this.input = input
    const pick = input.latestPick
    if (!this.initialised) {
      this.initialised = true
      this.lastPickKey = pick?.key ?? null
      this.lastPickNumber = pick?.pickNumber ?? 0
      this.lastTurnKey = input.onClockKey
      return
    }

    // ---- picks ----
    const key = pick?.key ?? null
    if (key !== this.lastPickKey) {
      if (pick === null) {
        // Every pick undone — nothing newer to name.
        this.lastPickKey = null
        this.lastPickNumber = 0
      } else if (pick.pickNumber < this.lastPickNumber) {
        // An undo: the newest pick is one the room was already told about.
        this.lastPickKey = key
        this.lastPickNumber = pick.pickNumber
      } else if (input.latestPickReady) {
        this.lastPickKey = key
        this.lastPickNumber = pick.pickNumber
        this.gather('pick', pickAnnouncement(pick))
      }
      // else: wait for the name — the next update re-checks.
    }

    // ---- whose turn ----
    if (input.onClockKey !== this.lastTurnKey) {
      this.lastTurnKey = input.onClockKey
      const sentence = onClockAnnouncement(input)
      if (sentence) this.gather('turn', sentence)
    }
  }

  /** One clock sample: the viewer's running remaining ms, or null when the
   *  clock is not running (paused, untimed, expired, idle). */
  sampleClock(remainingMs: number | null): void {
    const input = this.input
    const allowed =
      input !== null && input.youAreOnClock && !(input.isAuction && input.nominationLive)
    if (!allowed) {
      this.previousRemainingMs = null
      return
    }
    if (input.onClockKey !== this.warnedTurnKey) {
      this.warnedTurnKey = input.onClockKey
      this.warned = new Set()
      this.previousRemainingMs = null
    }
    const crossed = crossedClockWarning(this.previousRemainingMs, remainingMs)
    this.previousRemainingMs = remainingMs
    if (crossed === null || this.warned.has(crossed)) return
    // A crossed threshold also retires every higher one for this turn.
    for (const threshold of CLOCK_WARNING_THRESHOLDS_MS) {
      if (threshold >= crossed) this.warned.add(threshold)
    }
    this.sayClock(clockWarningAnnouncement(crossed, input.isAuction))
  }

  dispose(): void {
    if (this.gatherHandle !== null) this.timers.clearTimeout(this.gatherHandle)
    this.gatherHandle = null
  }

  private gather(part: 'pick' | 'turn', sentence: string): void {
    this.pending[part] = sentence
    if (this.gatherHandle !== null) return
    this.gatherHandle = this.timers.setTimeout(() => {
      this.gatherHandle = null
      const { pick, turn } = this.pending
      this.pending = { pick: null, turn: null }
      const said = composeTurnAnnouncement(pick, turn)
      if (said) this.sayTurn(said)
    }, ANNOUNCE_GATHER_MS)
  }
}
