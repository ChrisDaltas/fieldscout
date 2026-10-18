/**
 * Editing a pending waiver claim on the phone (gap list §3 #13): the bid,
 * the drop and the claim order — the pure half of `claim-sheets.tsx`.
 *
 * Everything here LABELS what the server said and keeps an invalid edit
 * from being offered (prevent, don't refuse). The verbs are the app's own:
 * `PATCH …/waivers/[cid]` with `{ faab_bid, drop_player_id }` (migration
 * 150's `waiver_claim_edit` — the add can't change; a different player is a
 * different claim) and with `{ claim_order }` (145's `waiver_claim_reorder`,
 * which refuses a smaller bid above a bigger one in a FAAB league — F422(b)).
 * The run order and where a move may land are the desktop panel's rules
 * (`claimsInRunOrder`, `canDragOnto`, `dropPlace`), reused as they are.
 */
import { canDragOnto, claimsInRunOrder, dropPlace } from '@/components/leagues/waiver-claims-ops'
import { bidAllowed } from '@/components/players/player-card-league-ops'
import type { RosterPlayer } from '@/lib/leagues/api/rosters-service'
import type { WaiverClaimView, WaiverClaimsDocument } from '@/lib/leagues/api/waivers-service'

export const EDIT_CLAIM_LABEL = 'Edit'
export const EDIT_CLAIM_TITLE = 'Edit claim'
export const CLAIM_UPDATED_COPY = 'Claim updated'
export const CLAIM_NOT_UPDATED_COPY = 'The claim wasn’t changed'
export const DROP_OPTIONAL_TITLE = 'Drop (optional)'
export const DROP_ONLY_IF_WON_NOTE = 'Only dropped if the claim goes through.'
export const EDIT_ROSTER_ERROR_COPY = 'Couldn’t read your roster right now.'

/** FAAB bids run from the league minimum to the team's balance (null = no
 *  known balance — the server's answer is the rule then); null = no bid to
 *  edit (a priority league). */
export function claimBidBounds(doc: Pick<WaiverClaimsDocument, 'waiver_type' | 'faab_min_bid' | 'faab_balance'>): { min: number; max: number | null } | null {
  return doc.waiver_type === 'faab' ? { min: doc.faab_min_bid, max: doc.faab_balance } : null
}

/** Where the edit starts: the claim as it stands. A drop who has left the
 *  roster since can't be kept (the run would void the claim), so the drop
 *  starts empty and `dropGone` names him for the note. */
export function claimEditStart(
  claim: Pick<WaiverClaimView, 'faab_bid' | 'drop'>,
  roster: readonly Pick<RosterPlayer, 'player_id'>[],
): { bid: number; dropId: string | null; dropGone: string | null } {
  const drop = claim.drop
  const onRoster = drop !== null && roster.some((p) => p.player_id === drop.player_id)
  return {
    bid: claim.faab_bid,
    dropId: onRoster ? drop.player_id : null,
    dropGone: drop !== null && !onRoster ? (drop.full_name ?? 'The player you’d drop') : null,
  }
}

/** "X isn't on your roster any more." — the note over the drop picker. */
export function dropGoneCopy(name: string): string {
  return `${name} isn’t on your roster any more.`
}

/** The drops your OTHER pending claims for the same player already name
 *  (null = one with no drop): two claims can't be the same claim (150
 *  refuses it), so an edit never offers one of these. */
export function takenDrops(claims: readonly Pick<WaiverClaimView, 'id' | 'status' | 'add' | 'drop'>[], claim: Pick<WaiverClaimView, 'id' | 'add'>): Set<string | null> {
  return new Set(
    claims.filter((c) => c.status === 'pending' && c.id !== claim.id && c.add.player_id === claim.add.player_id).map((c) => c.drop?.player_id ?? null),
  )
}

/** The players the drop may name: every unlocked one (the claim flow's
 *  rule) that no other claim for the same player already drops, and the
 *  claim's current drop even if his game has started — keeping the drop as
 *  it is is not a new move. */
export function claimDropChoices<P extends Pick<RosterPlayer, 'player_id'>>(
  roster: readonly P[],
  currentDropId: string | null,
  isLocked: (p: P) => boolean,
  taken: ReadonlySet<string | null> = new Set(),
): P[] {
  return roster.filter((p) => p.player_id === currentDropId || (!isLocked(p) && !taken.has(p.player_id)))
}

/** Whether Save is live: something changed, a full roster still names a
 *  drop, the drop isn't another claim's, and a FAAB bid is inside its
 *  bounds. */
export function claimEditState(input: {
  claim: Pick<WaiverClaimView, 'faab_bid' | 'drop'>
  bounds: { min: number; max: number | null } | null
  bid: number
  dropId: string | null
  needsDrop: boolean
  taken?: ReadonlySet<string | null>
}): { changed: boolean; ready: boolean } {
  const { claim, bounds, bid, dropId, needsDrop, taken } = input
  const changed = (bounds !== null && bid !== claim.faab_bid) || dropId !== (claim.drop?.player_id ?? null)
  const valid = !(needsDrop && dropId === null) && !(taken?.has(dropId) ?? false) && (bounds === null || bidAllowed(bid, bounds))
  return { changed, ready: changed && valid }
}

/** The edit's body for `useEditClaim`: the bid is SET, the drop is SET
 *  (null = none). A priority league's bid is always $0 — 150's edit refuses
 *  anything else there, and a claim can still carry a stray bid from before
 *  the league switched off FAAB (F432), so it is never sent back as stored. */
export function claimEditChange(faab: boolean, bid: number, dropId: string | null): { faab_bid: number; drop_player_id: string | null } {
  return { faab_bid: faab ? bid : 0, drop_player_id: dropId }
}

// ---------------------------------------------------------------------------
// Claim order
// ---------------------------------------------------------------------------

export interface ClaimOrderRow {
  claim: WaiverClaimView
  /** 1 = tried first. */
  rank: number
  /** The `claim_order` to send for a move up / down; null = that arrow is
   *  off (the first / last row, or — FAAB — a neighbour with another bid). */
  up: number | null
  down: number | null
}

/** The pending claims in the order the run tries them, each with the moves
 *  it may make — one place up or down, onto a neighbour the run would let
 *  it pass (the desktop drag's rule). */
export function claimOrderRows(doc: Pick<WaiverClaimsDocument, 'claims' | 'waiver_type'>): ClaimOrderRow[] {
  const ordered = claimsInRunOrder(doc.claims, doc.waiver_type)
  const placeOnto = (claim: WaiverClaimView, neighbour: WaiverClaimView | undefined) =>
    neighbour && canDragOnto(ordered, claim.id, neighbour.id, doc.waiver_type) ? dropPlace(doc.claims, neighbour.id) : null
  return ordered.map((claim, i) => ({ claim, rank: i + 1, up: placeOnto(claim, ordered[i - 1]), down: placeOnto(claim, ordered[i + 1]) }))
}

/** The one line over the order: what decides it, and what the arrows do. */
export function claimOrderCaption(rows: readonly ClaimOrderRow[], waiverType: string | null): string {
  if (waiverType !== 'faab') return 'Tried top to bottom. Use the arrows to change the order.'
  return rows.some((r) => r.up !== null || r.down !== null)
    ? 'Tried biggest bid first. Use the arrows to order claims with the same bid.'
    : 'Tried biggest bid first — change a bid to change the order.'
}

/** A row's second line: "$7 bid · drop J. Love" / "$7 bid · no drop";
 *  without bids "Drop J. Love" / "No drop". */
export function claimOrderMeta(claim: Pick<WaiverClaimView, 'faab_bid' | 'drop'>, faab: boolean, dropName: (name: string, position: string | null) => string): string {
  const drop = claim.drop ? `drop ${dropName(claim.drop.full_name ?? 'a player', claim.drop.position)}` : 'no drop'
  return faab ? `$${claim.faab_bid} bid · ${drop}` : `${drop.charAt(0).toUpperCase()}${drop.slice(1)}`
}
