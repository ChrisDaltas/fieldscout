/**
 * Draft-room realtime doctrine — the PURE half of `useDraftRoom` (M2 task
 * L.B3.1; spec §9.3 — every line there is a requirement; tasks-M2 §4.5).
 *
 * The repo's first realtime client keeps its doctrine testable without a
 * socket: this module is the gap/refetch reducer the subscribe half runs
 * every broadcast through, plus the heartbeat/clock-offset math. Colocated
 * with `use-draft.ts` (the L.A2.x ops-split precedent applied to a hook) and
 * pure — no client, no React, and **no wall-clock read anywhere**: every
 * time-dependent function takes sampled milliseconds as a parameter (the
 * §9.3 grep-able rule — no `Date.now()` inside deadline math; the component
 * tick only drives re-render).
 *
 * Contract (§9.3 + D109):
 * - Broadcasts are cache-invalidation + payload HINTS. Applying one may
 *   never be trusted over the authoritative REST state — on any doubt the
 *   reducer answers `refetch: true` and the hook refetches.
 * - `drafts.updated_at` is the monotonic `state_version` (D92/D109(2)): a
 *   stale or replayed drafts event is ignored; a version that implies picks
 *   we never saw is a GAP ⇒ refetch.
 * - `draft_picks` events carry exactly the §5 six columns (no `id` — D109(2):
 *   another row's key is not broadcast), so hint rows are keyed by
 *   (pick_number, player_id) and carry `id: null` until a refetch reconciles.
 * - The tick heartbeat ({server_now, current_deadline} every ~5s — 068 ARM 3)
 *   corrects the clock offset and doubles as a gap detector: a deadline we
 *   don't recognize means we missed a drafts UPDATE ⇒ refetch.
 */

import type { Draft } from '@/types/database'

import type { DraftPickSummary, DraftState } from './use-draft'

// ---------------------------------------------------------------------------
// Broadcast envelope shapes (070's column-selected payloads — D109(2); the
// wire-pinned key sets live in draft-realtime-db.test.ts / pgTAP 024)
// ---------------------------------------------------------------------------

/** The `drafts` UPDATE payload record — the §5 inventory + deadline_remaining_ms. */
export interface DraftsBroadcastRecord {
  status: string
  current_pick_number: number | null
  current_round: number | null
  on_clock_team_id: string | null
  current_deadline: string | null
  paused_at: string | null
  deadline_remaining_ms: number | null
  updated_at: string | null
}

/** The `draft_picks` INSERT/UPDATE payload record — exactly the §5 six. */
export interface PickBroadcastRecord {
  pick_number: number
  round: number | null
  team_id: string
  player_id: string
  is_auto: boolean | null
  is_undone: boolean | null
}

/** The tick heartbeat payload (068 ARM 3; §9.1's clock-drift beat). */
export interface TickHeartbeat {
  server_now: string
  current_deadline: string | null
}

/**
 * One broadcast off the `draft:<id>` topic, as the hook hands it to the
 * reducer. `event` is the client's dispatch discriminator (D109(1): event =
 * table name; one topic multiplexes four sources + 'tick'). Unknown events
 * (M3's `draft_bids`, future additions) are deliberately inert — additive
 * surfaces must not force refetch loops on older clients.
 */
export interface DraftRoomBroadcast {
  event: string
  operation?: string
  record?: unknown
}

export interface ReduceResult {
  /** Next cache state — the SAME reference when nothing was applied. */
  state: DraftState
  /** True ⇒ the hook must refetch authoritative state (§9.3 gap ⇒ refetch). */
  refetch: boolean
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/** ISO → ms, null-safe; NaN (malformed) → null. */
function instantMs(iso: string | null | undefined): number | null {
  if (iso == null) return null
  const ms = Date.parse(iso)
  return Number.isNaN(ms) ? null : ms
}

/** Highest pick_number we know of, undone rows included (re-picks reuse
 *  numbers ≤ max, so they are never mistaken for a gap). */
export function maxKnownPickNumber(picks: readonly DraftPickSummary[]): number {
  let max = 0
  for (const pick of picks) if (pick.pick_number > max) max = pick.pick_number
  return max
}

function isDraftsRecord(record: unknown): record is DraftsBroadcastRecord {
  return (
    typeof record === 'object' &&
    record !== null &&
    'status' in record &&
    'updated_at' in record
  )
}

function isPickRecord(record: unknown): record is PickBroadcastRecord {
  return (
    typeof record === 'object' &&
    record !== null &&
    typeof (record as PickBroadcastRecord).pick_number === 'number' &&
    typeof (record as PickBroadcastRecord).player_id === 'string' &&
    typeof (record as PickBroadcastRecord).team_id === 'string'
  )
}

// ---------------------------------------------------------------------------
// The reducer
// ---------------------------------------------------------------------------

function reduceDraftsEvent(state: DraftState, record: DraftsBroadcastRecord): ReduceResult {
  // No baseline to patch — the fetch should have preceded the subscribe
  // (§9.3 fetch-then-subscribe); refetch rather than invent a row.
  if (!state.draft) return { state, refetch: true }

  const known = instantMs(state.draft.updated_at)
  const incoming = instantMs(record.updated_at)

  // Stale or replayed state_version ⇒ ignore (the newer state is already
  // rendered; cache-hint semantics make dropping the old hint safe).
  if (incoming !== null && known !== null && incoming <= known) {
    return { state, refetch: false }
  }
  // A hint with no parsable version is doubt, not data.
  if (incoming === null) return { state, refetch: true }

  const draft: Draft = {
    ...state.draft,
    status: record.status,
    current_pick_number: record.current_pick_number,
    current_round: record.current_round,
    on_clock_team_id: record.on_clock_team_id,
    current_deadline: record.current_deadline,
    paused_at: record.paused_at,
    deadline_remaining_ms: record.deadline_remaining_ms,
    updated_at: record.updated_at,
  }

  // GAP: the server is past picks we never received (a drafts advance whose
  // sibling pick INSERT was missed or is still in flight) ⇒ refetch. The
  // patched hint still renders immediately — refetch reconciles.
  const gap =
    record.current_pick_number !== null &&
    record.current_pick_number > maxKnownPickNumber(state.picks) + 1

  return { state: { draft, picks: state.picks }, refetch: gap }
}

function reducePickInsert(state: DraftState, record: PickBroadcastRecord): ReduceResult {
  // Replay of a row we already hold (same pick, player, undone-ness) ⇒ inert.
  const duplicate = state.picks.some(
    (p) =>
      p.pick_number === record.pick_number &&
      p.player_id === record.player_id &&
      Boolean(p.is_undone) === Boolean(record.is_undone),
  )
  if (duplicate) return { state, refetch: false }

  // GAP: a pick number that skips ahead means we missed at least one INSERT
  // ⇒ refetch (§9.3). Re-picks after an undo reuse numbers ≤ max and land in
  // the else-branch as ordinary appends.
  const gap = record.pick_number > maxKnownPickNumber(state.picks) + 1

  const hint: DraftPickSummary = {
    // D109(2): pick broadcasts carry no id — hint rows hold null until the
    // next refetch reconciles the authoritative row (consumers key on
    // pick_number).
    id: null,
    pick_number: record.pick_number,
    round: record.round,
    team_id: record.team_id,
    player_id: record.player_id,
    is_auto: record.is_auto,
    is_undone: record.is_undone,
    made_via: null,
    created_at: null,
  }
  const picks = [...state.picks, hint].sort((a, b) => a.pick_number - b.pick_number)
  return { state: { draft: state.draft, picks }, refetch: gap }
}

function reducePickUpdate(state: DraftState, record: PickBroadcastRecord): ReduceResult {
  // Already reflected (e.g. the refetch beat the broadcast) ⇒ inert replay.
  // Identity is ALL six broadcast fields — R260 (M2 batch 12): 069's
  // commissioner reassign/move UPDATE team_id (and possibly player_id)
  // WITHOUT touching is_undone, so a (pick_number, player_id, is_undone)
  // triple is not row identity; treating it as such silently dropped those
  // events and left the board wrong for the rest of the draft.
  const reflected = state.picks.some(
    (p) =>
      p.pick_number === record.pick_number &&
      p.player_id === record.player_id &&
      p.team_id === record.team_id &&
      p.round === record.round &&
      Boolean(p.is_auto) === Boolean(record.is_auto) &&
      Boolean(p.is_undone) === Boolean(record.is_undone),
  )
  if (reflected) return { state, refetch: false }

  // The row this UPDATE patches: same (pick_number, player_id) — the hint
  // key (D109(2): no id on the wire). Exactly one match ⇒ patch every other
  // rendered field in place (undo flips, reassign team edits, move-player
  // alike). Zero matches (a reassign that swapped the PLAYER — the cached
  // row now names a player the draft no longer holds at that pick) or
  // several (an undone row plus a re-pick of the same player at the same
  // number) is doubt ⇒ refetch (§9.3).
  const matches = state.picks.filter(
    (p) => p.pick_number === record.pick_number && p.player_id === record.player_id,
  )
  if (matches.length !== 1) return { state, refetch: true }

  const target = matches[0]
  const picks = state.picks.map((p) =>
    p === target
      ? {
          ...p,
          round: record.round,
          team_id: record.team_id,
          is_auto: record.is_auto,
          is_undone: record.is_undone,
        }
      : p,
  )
  return { state: { draft: state.draft, picks }, refetch: false }
}

/**
 * Apply one broadcast to the cached room state. Pure; the hook writes the
 * returned state into the React Query cache and refetches when told to.
 */
export function applyDraftRoomEvent(
  state: DraftState,
  broadcast: DraftRoomBroadcast,
): ReduceResult {
  switch (broadcast.event) {
    case 'drafts': {
      if (!isDraftsRecord(broadcast.record)) return { state, refetch: true }
      return reduceDraftsEvent(state, broadcast.record)
    }
    case 'draft_picks': {
      if (!isPickRecord(broadcast.record)) return { state, refetch: true }
      if (broadcast.operation === 'UPDATE') return reducePickUpdate(state, broadcast.record)
      if (broadcast.operation === 'INSERT') return reducePickInsert(state, broadcast.record)
      // An operation we don't recognize on a table we render ⇒ doubt.
      return { state, refetch: true }
    }
    case 'league_chat':
      // The chat pane is L.B3.3's consumer — the subscribe half already
      // receives these on the shared topic; until the pane lands they are
      // deliberately inert (never a refetch: chat is not room state).
      return { state, refetch: false }
    default:
      // Unknown events (M3's auction surfaces, future additions) are inert —
      // an older client must not refetch-loop on additive traffic.
      return { state, refetch: false }
  }
}

// ---------------------------------------------------------------------------
// Heartbeat (068 ARM 3) — clock offset + the missed-update detector
// ---------------------------------------------------------------------------

/**
 * Clock offset from a heartbeat: server_now − the client clock sampled at
 * receipt. Positive ⇒ the client clock runs behind the server. Malformed
 * server_now ⇒ null (keep the previous offset; never guess).
 */
export function computeClockOffsetMs(
  serverNowIso: string,
  sampledClientMs: number,
): number | null {
  const serverMs = instantMs(serverNowIso)
  return serverMs === null ? null : serverMs - sampledClientMs
}

/** Offset-sample window size (~last minute of ~5s beats). */
export const OFFSET_SAMPLE_WINDOW = 12

/**
 * The offset the clock should use, from a window of per-beat samples.
 * Delivery/processing delay can only make a sample SMALLER (server_now is
 * stamped at emit; receipt only gets later), so the truest estimate is the
 * MAX of recent samples — a beat that sat queued through a reconnect (the
 * D39 pass observed one inflate the countdown by ~40s) cannot drag the
 * clock. Windowed so genuine client-clock drift still tracks over a long
 * draft. Empty window ⇒ null (caller keeps 0 until the first beat).
 */
export function bestClockOffsetMs(samples: readonly number[]): number | null {
  if (samples.length === 0) return null
  return Math.max(...samples)
}

/**
 * Beat-silence threshold: a LIVE draft beats every tick pass (~5s — 068
 * ARM 3; §9.1 prints 15s as the correction cadence, and this tolerates ≤ 2
 * missed printed-cadence beats, the draft_liveness_freshness symmetry).
 * Silence past it while we believe the draft is live is doubt ⇒ refetch.
 * This is the recovery for the one divergence no event can correct: a LOST
 * pause broadcast — a paused draft emits no beats (D109(6)), so only the
 * absence of beats can reveal it.
 */
export const HEARTBEAT_SILENCE_MS = 45_000

export function heartbeatSilenceExceeded(
  lastBeatAtMs: number,
  nowMs: number,
): boolean {
  return nowMs - lastBeatAtMs > HEARTBEAT_SILENCE_MS
}

/**
 * True when the heartbeat's deadline is not the one we hold — we missed a
 * drafts UPDATE (pause/resume/clock-edit/advance) ⇒ refetch. Both-null
 * (untimed) agrees. A heartbeat while we believe the draft is paused
 * mismatches by construction (paused drafts get no beat and hold a NULL
 * deadline — D109(6)), which is exactly the missed-resume recovery.
 */
export function heartbeatSignalsGap(
  state: DraftState,
  heartbeat: Pick<TickHeartbeat, 'current_deadline'>,
): boolean {
  if (!state.draft) return true
  return instantMs(state.draft.current_deadline) !== instantMs(heartbeat.current_deadline)
}
