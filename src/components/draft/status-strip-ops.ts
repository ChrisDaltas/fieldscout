/**
 * Status-strip view model (spec §16.4 zone 2; tasks-DR DR.4, D149) — the
 * pure left/right assignment for `draft-status-strip.tsx`, pinned by a
 * golden table in `status-strip-ops.test.ts` (the command-bar-ops
 * precedent: a plain `.ts` because vitest under `jsx: "preserve"` cannot
 * import the `.tsx`).
 *
 * D149's one-band contract, derived here and nowhere else: the strip's two
 * ends read *whose turn* and *how long*. Chris's requirement (3) — "'You're
 * on the clock' needs to be moved to the left side of the div" — is encoded
 * structurally: `left[0]` is ALWAYS the on-the-clock line (the strip's
 * leading element), and `right` is ALWAYS the clock. M2 shipped both in the
 * right cluster (`draft-room.tsx`'s status Card); this model makes that
 * arrangement unrepresentable rather than merely restyled.
 *
 * The middle is presence (`PresenceBar` — one chip per franchise in draft
 * order, which is also §16.4's "draft order" strip content): flexible,
 * scrollable, never the edges.
 */

export interface StatusStripInput {
  paused: boolean
  /** `drafts.current_round` / `current_pick_number` (server-authoritative). */
  round: number | null
  pickNumber: number | null
  youAreOnClock: boolean
  /** The on-clock franchise's name, when known (never an email — v2.9). */
  onClockTeamName: string | null
  /** `pickLabel(myNextPick, teamCount)`, or null (no seat / none left). */
  myNextPickLabel: string | null
}

/** The left run, leading → trailing. `onClock` is index 0 by construction. */
export interface StatusStripLeft {
  /** Requirement (3): the strip's LEADING element — whose turn. */
  onClock: { text: string; you: boolean }
  badge: 'live' | 'paused'
  round: string
  pick: string
  /** The "Your next: …" hint's pick label (e.g. `3.09`), shown only when
   *  seated and NOT on the clock — the prefix is view copy so the label
   *  keeps its `fs-num` render; the component keeps the hint's shipped
   *  `hidden sm:inline` responsive behavior. */
  nextHint: { label: string } | null
}

export interface StatusStripModel {
  left: StatusStripLeft
  /** The flexible middle: presence / draft order chips. */
  middle: { presence: true }
  /** The RIGHT edge — how long. Always the clock, always last (D149). */
  right: { clock: true }
}

export function statusStripModel(input: StatusStripInput): StatusStripModel {
  const { paused, round, pickNumber, youAreOnClock, onClockTeamName, myNextPickLabel } = input

  const onClockText = youAreOnClock
    ? "You're on the clock"
    : onClockTeamName
      ? `On the clock · ${onClockTeamName}`
      : 'On the clock'

  return {
    left: {
      onClock: { text: onClockText, you: youAreOnClock },
      badge: paused ? 'paused' : 'live',
      round: round === null ? '—' : String(round),
      pick: pickNumber === null ? '—' : String(pickNumber),
      nextHint:
        myNextPickLabel !== null && !youAreOnClock ? { label: myNextPickLabel } : null,
    },
    middle: { presence: true },
    right: { clock: true },
  }
}
