/**
 * Mock-launcher view derivations (M2 task L.B3.5; spec §8.8 launch/lifecycle,
 * §16.2 `mock-draft-launcher`, §16.5.2 mock-workflow row, §22.5 caps; D103/
 * D110). Pure — colocated ops split (the D82(4)/L.A2.x precedent).
 *
 * Authorization/validation all live in `create_mock_draft`/`delete_mock_draft`
 * (071) — these derivations only decide what the launcher RENDERS: the seat
 * options, the cap messaging, and the resume/recap card labels. The one
 * client-side cap read (3 active) exists so the launch button can be honest
 * BEFORE a refused round-trip — a PARTIAL read: it sees THIS league's actives
 * only, while 071 counts per-user across all leagues (see
 * `launchDisabledReason` — R280); the hourly cap is deliberately server-only
 * (creation instants of deleted mocks are invisible to the client — D110(6))
 * and its refusal surfaces verbatim.
 */

import type { MockDraftSummary } from '@/hooks/use-mock-drafts'

// ---------------------------------------------------------------------------
// Caps (§22.5 — the RPC enforces; these mirror its printed numbers for copy)
// ---------------------------------------------------------------------------

/** §22.5: active (live|paused) mocks per user — complete recaps don't count. */
export const MOCK_ACTIVE_CAP = 3
/** §22.5: mock creations per user per hour (server-counted — D110(6)). */
export const MOCK_HOURLY_CAP = 5

/** The standing cap line the launcher prints (§16.5.2 "3-active cap
 *  message" + the hourly half so the server's refusal never surprises). */
export const MOCK_CAP_NOTE = `Up to ${MOCK_ACTIVE_CAP} practice drafts running at once, ${MOCK_HOURLY_CAP} launches per hour.`

/** §8.8: abandoned (paused) mocks auto-expire. The half that is true of the
 *  ACTIVE list on every surface, whatever the finished ones are called. */
export const MOCK_PAUSED_EXPIRY_NOTE =
  'A paused practice draft keeps for 72 hours of inactivity, then cleans itself up.'

/**
 * The league launcher's combined note — the sentence above plus the kept-recap
 * half (§8.8: finished recaps never expire).
 *
 * **Composed, not restated, and deliberately NOT used on `/app/mocks` (R517).**
 * A standalone mock's finished state is a *report*, not a *recap* (D241(7)), so
 * printing this second sentence there would put both words on one screen — the
 * one-voice rule broken by the very constant that carries the rule's other
 * half. The practice home prints `MOCK_PAUSED_EXPIRY_NOTE` alone.
 */
export const MOCK_EXPIRY_NOTE = `${MOCK_PAUSED_EXPIRY_NOTE} Finished recaps stay until you delete them.`

/**
 * Why the launch button is disabled, or null when launching is offered.
 * ONLY the 3-active cap gets a client-side pre-flight — and a PARTIAL one
 * (R280): the count the caller passes comes from the launcher's league-scoped
 * GET, while 071's cap counts the user's active mocks across ALL leagues
 * (071:338–343 — no league filter). Cross-league actives are invisible here,
 * so this check can under-count, never over-block: when it misses, the RPC's
 * verbatim refusal is the authority (as it is for every other refusal —
 * hourly cap, league status, seat validity).
 */
export function launchDisabledReason(activeCount: number): string | null {
  if (activeCount >= MOCK_ACTIVE_CAP) {
    return `You already have ${MOCK_ACTIVE_CAP} practice drafts running — finish or delete one to start another.`
  }
  return null
}

// ---------------------------------------------------------------------------
// Seat picker (§8.8: "their real seat by default (any seat selectable)")
// ---------------------------------------------------------------------------

export interface MockSeatOption {
  teamId: string
  name: string
  /** The launcher's own franchise — the picker's default. */
  isMine: boolean
}

export interface SeatTeamInput {
  id: string
  name: string
  status?: string | null
}

interface SeatMemberInput {
  user_id: string | null
  team_id: string | null
}

/**
 * Selectable seats: every NON-retired franchise (071's exact filter — a
 * placeholder or another member's franchise is legal; the mock human driver
 * is launcher-keyed, never seat-owner-keyed — D103(2)). The launcher's own
 * franchise is flagged so the picker defaults to it.
 */
export function mockSeatOptions(
  teams: readonly SeatTeamInput[],
  members: readonly SeatMemberInput[],
  userId: string | null,
): MockSeatOption[] {
  const myTeamId =
    (userId && members.find((m) => m.user_id === userId)?.team_id) || null
  return teams
    .filter((t) => t.status !== 'retired')
    .map((t) => ({ teamId: t.id, name: t.name, isMine: t.id === myTeamId }))
}

/** The picker's default: the launcher's real seat, else the first seat
 *  (a member with no franchise must still pick one — 071 refuses a NULL
 *  seat for the teamless with its own friendly message). */
export function defaultMockSeatId(options: readonly MockSeatOption[]): string | null {
  return options.find((o) => o.isMine)?.teamId ?? options[0]?.teamId ?? null
}

// ---------------------------------------------------------------------------
// Slot picker (MS.8; §8.8 parity/E77; D223 — "choose your slot at launch")
// ---------------------------------------------------------------------------

/** The picker's default option value: no slot sent, the server's seeded
 *  shuffle unchanged (byte-for-byte the pre-MS.8 behaviour — pgTAP 050). */
export const RANDOM_SLOT = 'random'

export interface MockSlotOption {
  /** `RANDOM_SLOT` or the slot number as a string (Select values are strings). */
  value: string
  label: string
}

/** "1st", "2nd", "3rd", … "11th", "12th", "13th", … — English ordinals over
 *  the v1 seat range (≤ 16). */
export function ordinalSlotLabel(n: number): string {
  const tens = n % 100
  if (tens >= 11 && tens <= 13) return `${n}th`
  const suffix = { 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] ?? 'th'
  return `${n}${suffix}`
}

/** Random (default) + 1st..Nth for an N-seat board. Both launch surfaces
 *  render exactly this list — one implementation, two mounts (D223(4): the
 *  launch dialog answers one question with one control; the full editor
 *  lives in the room). */
export function mockSlotOptions(teamCount: number): MockSlotOption[] {
  return [
    { value: RANDOM_SLOT, label: 'Random' },
    ...Array.from({ length: teamCount }, (_, i) => ({
      value: String(i + 1),
      label: ordinalSlotLabel(i + 1),
    })),
  ]
}

/** The wire value for a picker selection: undefined for Random (key omitted
 *  — the RPC's DEFAULT NULL is the equivalence pin), the number otherwise. */
export function slotFromPickerValue(value: string): number | undefined {
  return value === RANDOM_SLOT ? undefined : Number(value)
}

/**
 * Why the slot picker is disabled on a LEAGUE launch, or null when the
 * choice is live. §8.8 fidelity: a mock INHERITS a drawn order ("order
 * incl. their actual slot"), so when the league's order is already set the
 * honest UI is the picker disabled with the reason — not a control that
 * launches into a refusal.
 *
 * A PARTIAL pre-flight, deliberately (the `launchDisabledReason` R280
 * shape): this sees what `LeagueDetail.settings` carries — a manual/custom
 * mode whose stored order covers the board. A `random` league whose lobby
 * already randomized onto the REAL draft row is invisible from here (the
 * draft row's order is not in the detail payload), so that case stays
 * enabled and the RPC's verbatim drawn-order refusal is the authority
 * (migration 102's resolver arm; pinned pgTAP 050 §E).
 */
export function drawnOrderSlotReason(settings: {
  team_count: number
  draft: { draft_order_mode: string; draft_order: string[] | null }
}): string | null {
  const { draft_order_mode: mode, draft_order: stored } = settings.draft
  if (
    (mode === 'manual' || mode === 'custom') &&
    stored !== null &&
    stored.length === settings.team_count
  ) {
    return 'This league’s draft order is already set — your practice draft inherits it, your actual slot included.'
  }
  return null
}

// ---------------------------------------------------------------------------
// Resume / recap card labels (§16.5.2 mock-workflow row)
// ---------------------------------------------------------------------------

/** "Paused · pick 37 of 96" — the resumable card's progress line. A mock
 *  with no derivable total still states its position honestly. */
export function mockProgressLabel(row: MockDraftSummary, teamCount: number | null): string {
  const state = row.status === 'paused' ? 'Paused' : 'Live'
  const pick = row.current_pick_number
  if (pick === null) return state
  const total =
    teamCount !== null && teamCount > 0 && row.total_rounds !== null
      ? teamCount * row.total_rounds
      : null
  return total !== null
    ? `${state} · pick ${pick} of ${total}`
    : `${state} · pick ${pick}`
}

// ---------------------------------------------------------------------------
// Seat counts — the denominator of the progress line, from two sources
// ---------------------------------------------------------------------------

/** A league mock's seat count: the league's non-retired franchises, the
 *  same filter `mockSeatOptions` uses. Extracted so the three `MockRow`
 *  mounts pass a NUMBER rather than a whole `LeagueDetail` — the practice
 *  home has no league to hand it (MP.5). */
export function activeSeatCount(teams: readonly SeatTeamInput[]): number {
  return teams.filter((t) => t.status !== 'retired').length
}

/**
 * A STANDALONE mock's seat count, read off the row itself: 095 stores the
 * bot `teams` ids it minted at `config.mock.cpu_seats`, one per opponent, so
 * the board is `cpu_seats.length + 1` — the human's own seat is the `+ 1`
 * and is not in that array (095's loop runs `1..team_count - 1`).
 *
 * Derived rather than selected because it is already stored: `cpu_seats` is
 * the DELETE authority for cleanup (D227(4)), not a field invented for this.
 *
 * NULL for a league-attached mock — 095 deliberately writes no `cpu_seats`
 * key there (a league mock mints nothing, so it stores nothing) — and null
 * is the honest answer: `mockProgressLabel` then prints the position with no
 * total instead of a made-up one.
 */
export function standaloneSeatCount(row: MockDraftSummary): number | null {
  const config = row.config as { mock?: { cpu_seats?: unknown } } | null
  const seats = config?.mock?.cpu_seats
  if (!Array.isArray(seats) || seats.length === 0) return null
  return seats.length + 1
}

/** The denominator for whichever shape the row is (MP.5). A league row gets
 *  its league's seat count; a standalone row reads its own. */
export function mockSeatCount(
  row: MockDraftSummary,
  leagueTeams: readonly SeatTeamInput[] | null,
): number | null {
  if (leagueTeams !== null) {
    const count = activeSeatCount(leagueTeams)
    return count > 0 ? count : null
  }
  return standaloneSeatCount(row)
}

// ---------------------------------------------------------------------------
// The LEAGUE mounts' open-blocked reason (MP.8 fix round — R540)
// ---------------------------------------------------------------------------

/** Why a finished mock's *View report* cannot be used while practice is off. */
export const MOCK_REPORT_HIDDEN_NOTE = 'Practice drafts are hidden right now.'

/**
 * Why a LEAGUE-mounted row's open control cannot be used, or null — MP.8's
 * fix round (**R540**), and it is **R515's defect in the mirror direction**.
 *
 * MP.8 made `MockRow`'s `reportHref` unconditionally `/app/mocks/[id]/report`
 * for all three mounts (D230(4): one surface, one word). That route lives
 * under `(shell)/mocks/layout.tsx`, which redirects the whole subtree to
 * `/app` when **`featureFlags.mockDrafts`** is off. So in the one flag cell
 * nobody's suite drove — **`leagues` ON, `mockDrafts` OFF** — a finished
 * league mock's *View report* became a live blue control that silently
 * bounces to `/app`. On `main` that href was the league recap, which renders
 * fine under that combination; the report link took the hazard on and nothing
 * disclosed it.
 *
 * `/app/mocks`' own mount does NOT need this arm — that page is inside the
 * same gate, so it cannot render at all with practice off. This is the two
 * LEAGUE mounts' answer (`league-home-states.tsx`, `mock-draft-launcher.tsx`),
 * and only a FINISHED row is affected: an unfinished league row's *Rejoin*
 * goes to `/app/leagues/…`, which the practice flag has nothing to do with
 * (that row's own hazard is the `leagues` flag, and `/app/mocks` owns it).
 *
 * **The flag is an ARGUMENT, not a read** (§4 rule 13 / D231(4); R519's
 * "in the PAGE, never in the shared row"): each mount reads
 * `featureFlags.mockDrafts` at its own call site and passes it, so the
 * decision stays visible where the page is and this stays a pure function
 * with a truth table.
 */
export function leagueMockOpenBlocked(
  row: Pick<MockDraftSummary, 'status'>,
  mockDraftsEnabled: boolean,
): string | null {
  if (row.status !== 'complete') return null
  return mockDraftsEnabled ? null : MOCK_REPORT_HIDDEN_NOTE
}

// ---------------------------------------------------------------------------
// The row's OWN identity (MP.10 — the launch-facing pass)
// ---------------------------------------------------------------------------

/**
 * §7.3.8's three draft types, in the words the launch dialog offers them by
 * (`mock-launch-dialog.tsx`'s Format step). Stored as a literal map rather
 * than derived from the string, so an unknown value CANNOT be printed: a raw
 * enum leaking onto a launch-facing row is the failure this guards.
 */
const MOCK_FORMAT_LABEL: Record<string, string> = {
  snake: 'Snake',
  auction: 'Auction',
  linear: 'Linear',
}

/**
 * What ONE row is, from the data the row already carries — MP.10 item 2's
 * overflow/long-content state for a LIST.
 *
 * Every `MockRow` printed the constant *"Practice draft"*, so the §22.5 cap's
 * three in-progress runs and every finished report beside them read as the
 * same object: nothing on screen separated a 12-team snake from an 8-team
 * auction. Chris's own use case is comparing runs (*"practice drafting these
 * players at these rounds or cost"*), and a list you cannot tell apart does
 * not support it. Measured on the local stack: three rows, three identical
 * titles, two identical progress lines.
 *
 * **No new read and no new column** — `draft_type` is already selected into
 * `MockDraftSummary` and the seat count is the denominator `mockProgressLabel`
 * already takes (`mockSeatCount`). This is presentation of data in hand.
 *
 * **It degrades rather than guesses** (the `mockProgressLabel` rule one line
 * up): an unrecognised `draft_type` falls back to the NOUN — *"Practice
 * draft"*, the constant this replaced — keeping the size half, which is still
 * true; and a row with no derivable seat count prints the format alone. It
 * never invents a team count and never prints a raw enum.
 *
 * §4 rule 16: this NAMES the object, it does not explain it — no sentence
 * about what a mock draft is.
 */
export function mockIdentityLabel(
  row: Pick<MockDraftSummary, 'draft_type'>,
  seatCount: number | null,
): string {
  const format = MOCK_FORMAT_LABEL[row.draft_type] ?? 'Practice draft'
  if (seatCount === null || seatCount <= 0) return format
  return `${format} · ${seatCount} teams`
}
