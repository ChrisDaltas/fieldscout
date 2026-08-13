/**
 * Draft bar — pure derivation (M2 task L.B3.4; the F38/D84 discharge of the
 * `useDraftAlert` TODO). The bar is the app-wide "look here" urgency signal
 * (mounted in app-shell on every route), so its rules live here, pinnable:
 *
 * - A LIVE draft always alerts (the strongest signal in the product).
 * - A SCHEDULED draft alerts only inside the soon-window (≤ 1h out, or past
 *   the instant while the league still says scheduled — draft night). A lime
 *   urgency bar that sits for three weeks means nothing on draft night;
 *   the countdown hero owns the long-range surface (recorded in D120).
 * - Suppressed on the target league's own draft-room route — the bar's one
 *   job is to pull you THERE.
 *
 * Time is `nowMs`-injected (the D82(4) precedent); the component owns the
 * ticking clock.
 */

/** The `useLeagues` row slice the bar reads. */
export interface DraftBarLeagueRow {
  id: string
  name: string
  status: string
}

export interface DraftBarAlert {
  live: boolean
  leagueId: string
  league: string
  detail: string
  href: string
}

/** How close a scheduled draft must be before the bar surfaces it. */
export const DRAFT_BAR_SOON_MS = 60 * 60_000

/**
 * Which league (if any) the bar watches: the first `drafting` league wins
 * (live beats everything); else the first `scheduled` league. First-listed
 * wins among several — one bar, one message (recorded latitude).
 */
export function draftBarCandidate(
  rows: readonly DraftBarLeagueRow[],
): DraftBarLeagueRow | null {
  return (
    rows.find((r) => r.status === 'drafting') ??
    rows.find((r) => r.status === 'scheduled') ??
    null
  )
}

/** "Starts in 42m" / "Starts in 3h 10m" / "Starting now". */
function startsIn(msLeft: number): string {
  if (msLeft <= 0) return 'Starting now'
  const totalMinutes = Math.ceil(msLeft / 60_000)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours > 0) return `Starts in ${hours}h ${minutes}m`
  return `Starts in ${minutes}m`
}

/**
 * The alert the bar renders, or null. `scheduledAt` is the candidate
 * league's `settings.draft.draft_scheduled_at` via the `useActiveDraft`
 * summary (D95's single pre-start store — meaningful with no drafts row,
 * D94). A scheduled candidate with no/unparseable instant stays silent: the
 * bar never claims an urgency it cannot date.
 */
export function deriveDraftAlert(
  candidate: DraftBarLeagueRow | null,
  scheduledAt: string | null,
  nowMs: number,
  pathname: string,
): DraftBarAlert | null {
  if (!candidate) return null
  const href = `/app/leagues/${candidate.id}/draft`
  // Already in this league's draft room (or its recap) — the bar's job is done.
  if (pathname.startsWith(href)) return null

  if (candidate.status === 'drafting') {
    return {
      live: true,
      leagueId: candidate.id,
      league: candidate.name,
      detail: 'Picks are coming off the board.',
      href,
    }
  }

  if (!scheduledAt) return null
  const targetMs = Date.parse(scheduledAt)
  if (Number.isNaN(targetMs)) return null
  const msLeft = targetMs - nowMs
  if (msLeft > DRAFT_BAR_SOON_MS) return null

  return {
    live: false,
    leagueId: candidate.id,
    league: candidate.name,
    detail: startsIn(msLeft),
    href,
  }
}
