/**
 * Leader election for the two-tabs guard — the pure half of
 * `use-single-room-tab.ts` (spec §9.3 v2.12; tasks-DR D156; DR.6).
 *
 * **RULED by Chris (2026-08-17, Q14): "The most recent one takes over and
 * the others disconnect."** The model is therefore newest-wins, total and
 * deterministic:
 *
 *   - A claim is `{tab_id, claimed_at, seq}`. Election compares ONLY
 *     `(claimed_at, tab_id)` — newest instant wins, and a same-millisecond
 *     tie breaks on `tab_id` so two tabs can never both hold the room.
 *     `seq` exists purely for the transport: a `storage` event only fires
 *     when the stored STRING changes, so every write (including a defend,
 *     which re-announces an UNCHANGED claim) bumps `seq` to stay visible on
 *     the localStorage fallback bus. It never participates in the election.
 *   - A tab that receives a WINNING claim releases. A HOLDING tab that
 *     receives a losing claim defends (re-announces its claim, `claimed_at`
 *     untouched) so a claimant with a skewed clock learns it lost; a
 *     released tab never defends — exactly one tab settles as holder.
 *   - Receiving is idempotent: the same claim delivered twice (both buses
 *     carry every claim) produces the same outcome.
 *
 * Pure — no time, no DOM, no storage — so the newest-wins invariant is
 * pinned without a browser. The hook owns the buses; this module owns who
 * wins.
 */

/** One browser-storage/broadcast namespace per draft: the guard is scoped
 *  to a single draft in a single browser profile (D156 — a laptop and a
 *  phone are two legitimate clients; this key can never reach them both). */
export const ROOM_TAB_KEY_PREFIX = 'fieldscout:room-tab:'

/** BroadcastChannel name AND localStorage key for a draft's election. */
export function roomTabKey(draftId: string): string {
  return `${ROOM_TAB_KEY_PREFIX}${draftId}`
}

/** A tab's claim on the room. */
export interface RoomTabClaim {
  /** Unique per tab instance (minted once per tab, kept for its lifetime). */
  tab_id: string
  /** The claim instant (epoch ms) — the thing newest-wins compares. */
  claimed_at: number
  /** Transport nonce so repeated writes change the stored string; NEVER
   *  part of the election (pinned). */
  seq: number
}

/** What a tab is, per draft: holding the room's connection, or released. */
export type RoomTabRole = 'holding' | 'released'

/** The result of receiving a claim: the tab's new role, and whether it must
 *  re-announce (defend) its own claim. */
export interface RoomTabOutcome {
  role: RoomTabRole
  defend: boolean
}

/**
 * Newest wins; a same-instant tie breaks deterministically on `tab_id`.
 * Total: for two DISTINCT tabs' claims, exactly one direction is true; a
 * tab's own claim never beats itself.
 */
export function claimBeats(challenger: RoomTabClaim, incumbent: RoomTabClaim): boolean {
  if (challenger.claimed_at !== incumbent.claimed_at) {
    return challenger.claimed_at > incumbent.claimed_at
  }
  return challenger.tab_id > incumbent.tab_id
}

/**
 * The election step. `mine` is this tab's own current claim, `role` its
 * current role, `incoming` a claim received on either bus.
 *
 *   - Own echo (the storage bus replays our own writes on some browsers,
 *     and defends re-announce): no change, never defend.
 *   - Incoming beats mine: release. The takeover state renders; the caller
 *     drops the room's draft id so `use-draft.ts`'s own effect cleanups
 *     unsubscribe the channel and stop the heartbeat.
 *   - Incoming loses: a holder defends (the claimant must learn it lost —
 *     the clock-skew guard); a released tab stays silent — the current
 *     holder is the one whose claim wins, and it defends for itself.
 */
export function outcomeForClaim(
  mine: RoomTabClaim,
  role: RoomTabRole,
  incoming: RoomTabClaim,
): RoomTabOutcome {
  if (incoming.tab_id === mine.tab_id) return { role, defend: false }
  if (claimBeats(incoming, mine)) return { role: 'released', defend: false }
  return { role, defend: role === 'holding' }
}

/** Shape guard for claims arriving off either bus — both carry attacker-
 *  free same-origin data, but a stale or foreign value must parse to
 *  nothing rather than throw. */
export function isRoomTabClaim(value: unknown): value is RoomTabClaim {
  if (typeof value !== 'object' || value === null) return false
  const claim = value as Record<string, unknown>
  return (
    typeof claim.tab_id === 'string' &&
    claim.tab_id !== '' &&
    typeof claim.claimed_at === 'number' &&
    Number.isFinite(claim.claimed_at) &&
    typeof claim.seq === 'number' &&
    Number.isFinite(claim.seq)
  )
}

/** localStorage payloads are JSON strings; garbage decodes to null. */
export function parseStoredClaim(raw: string | null): RoomTabClaim | null {
  if (raw === null || raw === '') return null
  try {
    const value: unknown = JSON.parse(raw)
    return isRoomTabClaim(value) ? value : null
  } catch {
    return null
  }
}
