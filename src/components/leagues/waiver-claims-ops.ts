/**
 * Waivers UI — pure derivation (M5 task L.D2.13; spec §13.2, §16.2
 * `waiver-claims-panel` / `free-agents-table`, §16.5.2's Waivers row
 * "pending · won/lost w/ reason · locked player rows · `fa_hold` countdown
 * chip"; PROGRESS F425, F432, D414).
 *
 * Everything here LABELS what the server said. Whether a claim may be made,
 * what it costs and who wins is the claim verb's and the run's (145 / 150);
 * this file decides only which buttons a row offers, in what order the
 * claims are shown, where a drag may land, and how an answer reads.
 *
 * NO CLOCK. The only "now" is the server's — the league detail's
 * `waiver_window.evaluated_at` — and the only instants compared are stored
 * ones (the `fa_hold` chip: acquired + hold vs. that server instant).
 */
import type { WaiverClaimView } from '@/lib/leagues/api/waivers-service'
import type { RosterPlayer } from '@/lib/leagues/api/rosters-service'
import type { LeagueSettings } from '@/lib/leagues/settings/league-settings'
import { WAIVER_PRESETS, canonicalWeekdays, type Weekday } from '@/lib/leagues/time/waiver-schedule'
import { waiverOrderBasis } from '@/lib/leagues/waivers/waiver-order'
import type { WaiverWindowView } from '@/lib/leagues/waivers/waiver-window-view'

import type { PoolPlayerRow } from './players-page-ops'

export type WaiverType = LeagueSettings['waiver_type']

// ---------------------------------------------------------------------------
// The order the run will use (F432 / F422(b))
// ---------------------------------------------------------------------------

/**
 * A team's pending claims in the order the run tries them. FAAB: the biggest
 * bid first, the team's own order only between equal bids (F422(b) — 150
 * ranks this way whatever the stored order says, so the panel shows it too,
 * including after a FAAB → priority → FAAB round trip left stray bids).
 * Priority types: the team's own order.
 */
export function claimsInRunOrder(claims: readonly WaiverClaimView[], waiverType: WaiverType | string | null): WaiverClaimView[] {
  const pending = claims.filter((c) => c.status === 'pending')
  return [...pending].sort((a, b) => {
    if (waiverType === 'faab' && a.faab_bid !== b.faab_bid) return b.faab_bid - a.faab_bid
    if (a.claim_order !== b.claim_order) return a.claim_order - b.claim_order
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })
}

/** Whether a claim may be dragged onto another's place. FAAB: only within an
 *  equal-bid group (a smaller-above-bigger move is 150's 409 by name —
 *  F432); priority types: anywhere. */
export function canDragOnto(ordered: readonly WaiverClaimView[], activeId: string, overId: string, waiverType: WaiverType | string | null): boolean {
  if (activeId === overId) return false
  const a = ordered.find((c) => c.id === activeId)
  const o = ordered.find((c) => c.id === overId)
  if (!a || !o) return false
  return waiverType !== 'faab' || a.faab_bid === o.faab_bid
}

/** Claims that share a bid with another (the only draggable ones in FAAB). */
export function draggableIds(ordered: readonly WaiverClaimView[], waiverType: WaiverType | string | null): Set<string> {
  if (waiverType !== 'faab') return new Set(ordered.length > 1 ? ordered.map((c) => c.id) : [])
  const counts = new Map<number, number>()
  for (const c of ordered) counts.set(c.faab_bid, (counts.get(c.faab_bid) ?? 0) + 1)
  return new Set(ordered.filter((c) => (counts.get(c.faab_bid) ?? 0) > 1).map((c) => c.id))
}

/**
 * The `claim_order` to send when `activeId` is dropped on `overId`: the
 * over-claim's place in the team's STORED order (the move route's "move this
 * claim to place N" — D387(1)). Within an equal-bid group the stored order
 * and the run order agree (150 keeps it bid-sorted), so the claim lands
 * exactly where it was dropped.
 */
export function dropPlace(claims: readonly WaiverClaimView[], overId: string): number | null {
  const stored = claims.filter((c) => c.status === 'pending').sort((a, b) => a.claim_order - b.claim_order)
  const i = stored.findIndex((c) => c.id === overId)
  return i < 0 ? null : i + 1
}

// ---------------------------------------------------------------------------
// Results — plain words for every stored reason
// ---------------------------------------------------------------------------

export type OutcomeTone = 'positive' | 'negative' | 'neutral'

export interface ClaimOutcome {
  label: string
  tone: OutcomeTone
  detail: string | null
}

const INVALID_WORDS: Record<string, string> = {
  team_retired: 'this team was retired before the run.',
  add_rostered: 'he was already on a roster by then.',
  add_locked: 'his game had already started.',
  drop_gone: 'the player you’d drop was no longer on your roster.',
  drop_locked: 'the player you’d drop had already played this week.',
  roster_full: 'your roster was full — claim again with a player to drop.',
  cap_reached: 'you’d used all the adds the league allows.',
  insufficient_faab: 'the bid was more than your FAAB left by then.',
  own_claim_won: 'one of your other claims went through first and made this one impossible.',
  no_waivers: 'the league turned waivers off — he can be picked up directly now.',
  seat_vacated: 'the team’s manager left the seat, so its claims were cancelled.',
  manager_left: 'the team’s manager left the league, so its claims were cancelled.',
}

export function claimOutcome(claim: Pick<WaiverClaimView, 'status' | 'result_reason' | 'faab_bid'>, waiverType: WaiverType | string | null): ClaimOutcome {
  switch (claim.status) {
    case 'pending':
      return { label: 'Pending', tone: 'neutral', detail: null }
    case 'won':
      return { label: 'Won', tone: 'positive', detail: waiverType === 'faab' ? `Won for $${claim.faab_bid}.` : 'Won — he’s on your roster.' }
    case 'lost':
      return {
        label: 'Lost',
        tone: 'negative',
        detail: claim.result_reason === 'lost_on_priority' ? 'Another team with higher waiver priority claimed him.' : 'Another team bid more.',
      }
    case 'cancelled': {
      const words = claim.result_reason && claim.result_reason !== 'cancelled' ? INVALID_WORDS[claim.result_reason] : null
      return { label: 'Cancelled', tone: 'neutral', detail: words ? `Cancelled — ${words}` : null }
    }
    case 'invalid': {
      const words = claim.result_reason ? INVALID_WORDS[claim.result_reason] : undefined
      return {
        label: 'Didn’t go through',
        tone: 'negative',
        detail: words ? `Didn’t go through — ${words}` : claim.result_reason ? `Didn’t go through (${claim.result_reason.replace(/_/g, ' ')}).` : null,
      }
    }
  }
}

// ---------------------------------------------------------------------------
// The window, said plainly
// ---------------------------------------------------------------------------

export const WAIVERS_PAUSED_COPY =
  'Waiver runs are paused right now — claims stay pending and nothing is spent until they restart.'
export const NO_WAIVERS_LINE = 'No waivers in this league — any unowned player whose game hasn’t started can be picked up at once.'

const DAY_WORDS: Record<string, string> = {
  sun: 'Sunday',
  mon: 'Monday',
  tue: 'Tuesday',
  wed: 'Wednesday',
  thu: 'Thursday',
  fri: 'Friday',
  sat: 'Saturday',
}

function clockWords(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number)
  if (!Number.isFinite(h) || !Number.isFinite(m)) return hhmm
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
}

/**
 * The one line the players page shows above its table. `fmt` formats a
 * stored instant for the VIEWER (the host's `formatInstantWithDate`).
 */
export function windowLine(
  window: WaiverWindowView | null | undefined,
  settings: Pick<LeagueSettings, 'free_agency_open_day' | 'free_agency_open_time' | 'waiver_time_zone'>,
  fmt: (iso: string) => string,
): { tone: 'accent' | 'caution' | 'neutral'; text: string } | null {
  if (!window) return null
  if (!window.waivers) return { tone: 'accent', text: NO_WAIVERS_LINE }
  const next = window.next_run_at ? fmt(window.next_run_at) : null
  const nextBit = next ? ` Next waiver run: ${next}.` : ''
  switch (window.why) {
    case 'open':
      return { tone: 'accent', text: `Free agency is open — pick up any unowned player whose game hasn’t started.${nextBit}` }
    case 'run_pending':
      return { tone: 'caution', text: 'Waivers are running now — pickups reopen as soon as the claims are settled.' }
    case 'awaiting_run':
      return { tone: 'caution', text: `Claims only until the next waiver run${next ? `, ${next}` : ''}. Put in a claim and it’s settled then.` }
    case 'before_opening_time':
      return {
        tone: 'caution',
        text: `Claims only — free agency opens ${DAY_WORDS[settings.free_agency_open_day] ?? settings.free_agency_open_day} at ${clockWords(settings.free_agency_open_time)} (${settings.waiver_time_zone}).${nextBit}`,
      }
    case 'claims_only':
      return { tone: 'neutral', text: `Every pickup in this league is a waiver claim.${nextBit}` }
    case 'no_waivers':
      return { tone: 'accent', text: NO_WAIVERS_LINE }
  }
}

// ---------------------------------------------------------------------------
// Which buttons a row offers (Claim beside Add — F425)
// ---------------------------------------------------------------------------

export type ActionState = { show: false } | { show: true; disabled: boolean; title: string | undefined }

export const LOCKED_CLAIM_TITLE = 'Locked — this player’s game has started; claims on him open once the week’s last game ends.'
export const CLAIM_TITLE = 'Put in a waiver claim — it’s settled at the next waiver run.'

export function claimOnlyAddTitle(nextRunLocal: string | null): string {
  return `Claims only right now — he can’t be picked up directly until free agency opens, so an add is refused.${nextRunLocal ? ` Claims are settled at the next waiver run, ${nextRunLocal}.` : ''}`
}

/**
 * Add and Claim for an UNOWNED row. The window is the server's, read when the
 * page loaded — it is NOT refreshed while the page stays open (nothing
 * invalidates the league detail at a waiver run), so it never DISABLES Add
 * (R1220, the R894 precedent): claims-only puts Claim first and gives Add an
 * advisory title, and if the add is refused the server's sentence (naming the
 * next run) renders verbatim. With no window (a failed read) both stay live.
 * `claimsLive: false` — a database without claims (pre-149, R1219) — means
 * no Claim at all. Locks come from the tick's view only (`row.lock`).
 */
export function pickupActions(
  row: Pick<PoolPlayerRow, 'availability' | 'lock'>,
  ctx: {
    waiverType: WaiverType | string
    window: WaiverWindowView | null | undefined
    addTitle: string | undefined
    lockedAddTitle: string
    nextRunLocal: string | null
    claimsLive?: boolean
  },
): { add: ActionState; claim: ActionState } {
  const noWaivers = ctx.waiverType === 'none_fcfs' || ctx.window?.waivers === false || ctx.claimsLive === false
  if (row.lock.locked) {
    return {
      add: { show: true, disabled: true, title: ctx.lockedAddTitle },
      claim: noWaivers ? { show: false } : { show: true, disabled: true, title: LOCKED_CLAIM_TITLE },
    }
  }
  if (noWaivers) return { add: { show: true, disabled: false, title: ctx.addTitle }, claim: { show: false } }
  const w = ctx.window
  // A dropped player on hold waits for the run whatever the window says —
  // offer the claim; the Add stays live (the server knows if the hold lapsed).
  if (row.availability.kind === 'on_waivers' || !w) {
    return { add: { show: true, disabled: false, title: ctx.addTitle }, claim: { show: true, disabled: false, title: CLAIM_TITLE } }
  }
  if (w.free_agency_open) return { add: { show: true, disabled: false, title: ctx.addTitle }, claim: { show: false } }
  return {
    add: { show: true, disabled: false, title: claimOnlyAddTitle(ctx.nextRunLocal) },
    claim: { show: true, disabled: false, title: CLAIM_TITLE },
  }
}

// ---------------------------------------------------------------------------
// The claim form
// ---------------------------------------------------------------------------

/** Parse the bid box: whole dollars or null (empty / not a whole number). */
export function parseBid(text: string): number | null {
  const t = text.trim()
  if (!/^\d{1,9}$/.test(t)) return null
  return Number(t)
}

/** An ADVISORY line under the bid box — the server's refusal is the rule. */
export function bidHint(bid: number | null, minBid: number, balance: number | null): string | null {
  if (bid === null) return 'Enter a whole-dollar bid.'
  if (bid < minBid) return `The league’s minimum bid is $${minBid}.`
  if (balance !== null && bid > balance) return `That’s more than your $${balance} FAAB left.`
  return null
}

export function claimSettlesCopy(nextRunLocal: string | null): string {
  return nextRunLocal ? `Settles at the next waiver run: ${nextRunLocal}.` : 'Settles at the next waiver run.'
}

/**
 * The seat's place in the waiver order, in plain words — L.D2.18 (F484,
 * migration 163). The number is the one the server STORED
 * (`league_members.waiver_priority`, from the draft's end); this only picks
 * the words around it (`waiverOrderBasis`, the processor's own rule):
 *   - a rolling-priority league: "Waiver priority #N";
 *   - a FAAB league whose equal bids go by the rolling order: "Ties on equal
 *     bids: you're #N" (or "#N" for another team);
 *   - a league decided by the standings says what decides — reverse draft
 *     order until week 1 is final, then reverse standings (Q72; a stale
 *     stored number from an earlier setting is never shown);
 *   - no stored order yet (a database before 163, or before the draft): a
 *     rolling league says where the order starts, a FAAB league says nothing
 *     more — exactly as before; never a guessed number.
 * Null = nothing to say (no waivers, or FAAB with no stored tie order).
 */
/** What decides a standings-based league's order (Q72), in plain words. */
export const STANDINGS_ORDER_COPY = 'reverse draft order until week 1 is final, then reverse standings'

export function waiverOrderCopy(
  settings: { waiver_type: string | null; faab_tiebreaker?: string | null },
  waiverPriority: number | null,
  own: boolean,
): string | null {
  const basis = waiverOrderBasis(settings.waiver_type, settings.faab_tiebreaker)
  if (basis === 'none') return null
  const faab = (settings.waiver_type ?? 'faab') === 'faab'
  if (basis === 'reverse_standings') {
    // R1287 / Q72: reverse DRAFT order until the first week is final (160
    // reads the standings only once weeks_final > 0), then reverse standings.
    return `${faab ? 'Ties on equal bids' : 'Waiver priority'}: ${STANDINGS_ORDER_COPY}`
  }
  if (waiverPriority === null) return faab ? null : 'Waiver priority starts from reverse draft order'
  if (faab) return own ? `Ties on equal bids: you’re #${waiverPriority}` : `Ties on equal bids: #${waiverPriority}`
  return `Waiver priority #${waiverPriority}`
}

/** The team page's seat line: FAAB left in a FAAB league, then the seat's
 *  place in the waiver order (`waiverOrderCopy`); null = nothing to say. */
export function waiverSeatCopy(
  settings: Pick<LeagueSettings, 'waiver_type' | 'faab_budget'> & { faab_tiebreaker?: string | null },
  seat: { faab_balance: number | null; waiver_priority: number | null },
  own = false,
): string | null {
  const parts = [
    settings.waiver_type === 'faab' ? faabLeftCopy(seat.faab_balance, settings.faab_budget) : null,
    waiverOrderCopy(settings, seat.waiver_priority, own),
  ].filter((p): p is string => p !== null)
  return parts.length > 0 ? parts.join(' · ') : null
}

export function faabLeftCopy(balance: number | null, budget: number | null): string {
  if (balance === null) return 'FAAB balance not set yet'
  return budget !== null ? `$${balance} of $${budget} FAAB left` : `$${balance} FAAB left`
}

// ---------------------------------------------------------------------------
// The whole league's waiver order (L.D3.15 — F494; spec §13.2 Q72, v2.16.72)
// ---------------------------------------------------------------------------

export const WAIVER_ORDER_TITLE = 'Waiver order'
export const WAIVER_TIE_ORDER_TITLE = 'Tie order for equal bids'
export const WAIVER_ORDER_ROLLING_CAPTION =
  'When teams claim the same player, the team higher on this list gets him. A team that wins a claim moves to the back of the line.'
export const WAIVER_ORDER_TIES_CAPTION =
  'The highest bid wins a player. When bids are equal, the team higher on this list gets him — and a team that wins a claim moves to the back.'
/** No stored order yet (before the draft ends, or a database before 163):
 *  where the order starts — never a guessed list. */
export const WAIVER_ORDER_FALLBACK_COPY = 'Waiver priority starts from reverse draft order'
export const WAIVER_TIE_ORDER_FALLBACK_COPY = 'Ties on equal bids start from reverse draft order'

export interface WaiverOrderRow {
  team_id: string
  name: string
  /** The STORED place (`league_members.waiver_priority`); null = none stored. */
  priority: number | null
  mine: boolean
}

export type WaiverOrderListView =
  /** No waivers (free agency only) — nothing to show. */
  | { kind: 'hidden' }
  /** Decided by the standings each run — the rule in words, never numbers
   *  (a stale stored number from an earlier setting is never shown). */
  | { kind: 'rule'; title: string; copy: string }
  /** A rolling order with nothing stored yet — where it starts. */
  | { kind: 'fallback'; title: string; copy: string }
  /** The stored order, #1 first; a team with no stored place last. */
  | { kind: 'order'; title: string; caption: string; rows: WaiverOrderRow[] }

/**
 * The league-wide waiver order (F494) over the STORED places the standings
 * read already carries (`waiver_priority` per team, L.D2.12). Nothing is
 * computed: the rows are sorted by the number the server stored; the words
 * come from `waiverOrderBasis` (the processor's own `v_persists` rule, as
 * everywhere else — `waiverOrderCopy`).
 */
export function waiverOrderListView(
  settings: { waiver_type: string | null; faab_tiebreaker?: string | null },
  teams: ReadonlyArray<{ team_id: string; name: string; waiver_priority: number | null }>,
  myTeamId: string | null,
): WaiverOrderListView {
  const basis = waiverOrderBasis(settings.waiver_type, settings.faab_tiebreaker)
  if (basis === 'none') return { kind: 'hidden' }
  const faab = (settings.waiver_type ?? 'faab') === 'faab'
  const title = faab ? WAIVER_TIE_ORDER_TITLE : WAIVER_ORDER_TITLE
  if (basis === 'reverse_standings') return { kind: 'rule', title, copy: `${waiverOrderCopy(settings, null, false)}.` }
  if (!teams.some((t) => t.waiver_priority !== null)) {
    return { kind: 'fallback', title, copy: `${faab ? WAIVER_TIE_ORDER_FALLBACK_COPY : WAIVER_ORDER_FALLBACK_COPY}.` }
  }
  const rows = teams
    .map((t) => ({ team_id: t.team_id, name: t.name, priority: t.waiver_priority, mine: myTeamId !== null && t.team_id === myTeamId }))
    // Stable: equal keys (only ever the unstored ones, last) keep the read's order.
    // PROBE: the read order kept (no sort)
  return { kind: 'order', title, caption: faab ? WAIVER_ORDER_TIES_CAPTION : WAIVER_ORDER_ROLLING_CAPTION, rows }
}

// ---------------------------------------------------------------------------
// The schedule editor (settings panel + create wizard — Q70 presets, F425's
// "full schedule editor")
// ---------------------------------------------------------------------------

export type ScheduleSettings = Pick<
  LeagueSettings,
  'waiver_type' | 'waiver_run_days' | 'waiver_run_time' | 'waiver_time_zone' | 'free_agency_opens' | 'free_agency_open_day' | 'free_agency_open_time'
>

/** The patch a preset pick writes. "No waivers" is a waiver TYPE; a schedule
 *  preset on a no-waivers league turns waivers back on as FAAB (the catalog
 *  default). Null = no such preset. */
export function presetPatch(presetId: string, current: Pick<LeagueSettings, 'waiver_type'>): Partial<LeagueSettings> | null {
  const preset = WAIVER_PRESETS.find((p) => p.id === presetId)
  if (!preset) return null
  return {
    ...preset.schedule,
    waiver_run_days: [...preset.schedule.waiver_run_days],
    ...(preset.waiverType ? { waiver_type: preset.waiverType } : current.waiver_type === 'none_fcfs' ? { waiver_type: 'faab' as const } : {}),
  }
}

/** Toggle one run day; the last remaining day cannot be removed (a schedule
 *  needs at least one run — the catalog refuses an empty list). */
export function toggleRunDay(days: readonly Weekday[], day: Weekday): Weekday[] {
  const on = days.includes(day)
  if (on && days.length === 1) return [...days]
  return canonicalWeekdays(on ? days.filter((d) => d !== day) : [...days, day])
}

/** The zones the editor offers (the cohort is US-based); the league's stored
 *  zone is always offered even when it is not one of them. */
export const SCHEDULE_ZONES: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'America/New_York', label: 'Eastern' },
  { value: 'America/Chicago', label: 'Central' },
  { value: 'America/Denver', label: 'Mountain' },
  { value: 'America/Phoenix', label: 'Arizona' },
  { value: 'America/Los_Angeles', label: 'Pacific' },
  { value: 'America/Anchorage', label: 'Alaska' },
  { value: 'Pacific/Honolulu', label: 'Hawaii' },
]

export function zoneOptions(current: string): ReadonlyArray<{ value: string; label: string }> {
  return SCHEDULE_ZONES.some((z) => z.value === current) ? SCHEDULE_ZONES : [...SCHEDULE_ZONES, { value: current, label: current }]
}

export const FREE_AGENCY_OPTIONS: ReadonlyArray<{ value: LeagueSettings['free_agency_opens']; label: string }> = [
  { value: 'after_waiver_run', label: 'Right after the waiver run' },
  { value: 'day_and_time', label: 'At a set day and time' },
  { value: 'never', label: 'Never — claims only' },
]

export const WEEKDAY_SHORT: Record<Weekday, string> = { sun: 'Sun', mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat' }

// ---------------------------------------------------------------------------
// The fa_hold chip (§7.3.4 fa_hold_hours; §16.5.2)
// ---------------------------------------------------------------------------

/**
 * The instant a player added from free agency comes off the hold, if he is
 * still on it at the SERVER's instant `evaluatedAt`. A drop before then sends
 * him straight back to free agency, not onto waivers (spec §7.3.4).
 */
export function faHoldUntil(player: Pick<RosterPlayer, 'acquisition_type' | 'acquired_at'>, faHoldHours: number, evaluatedAt: string | null | undefined): string | null {
  if (faHoldHours <= 0 || player.acquisition_type !== 'free_agent' || !player.acquired_at || !evaluatedAt) return null
  const acquired = Date.parse(player.acquired_at)
  const at = Date.parse(evaluatedAt)
  if (Number.isNaN(acquired) || Number.isNaN(at)) return null
  const until = acquired + faHoldHours * 3_600_000
  return until > at ? new Date(until).toISOString() : null
}

export const FA_HOLD_TITLE = 'Just picked up — dropped before then, he goes straight back to free agency instead of onto waivers.'
