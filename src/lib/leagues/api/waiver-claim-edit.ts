/**
 * Edit a pending waiver claim's bid / drop — M5 task L.D2.12, carrying
 * PROGRESS D383(2): *"changing a bid is cancel + resubmit (+ reorder) —
 * L.D2.12/13 should offer an atomic edit."*
 *
 * **What this is, honestly.** 145 has no edit verb, and this task adds no
 * migration, so an edit is THREE server calls — cancel the old claim, submit
 * the new one (it lands at the back of the team's order), move it back to the
 * old claim's place. Each call is idempotent on its own `action_id`, but the
 * three are NOT one transaction. So this function makes the edit
 * atomic-LOOKING and loud about the one gap:
 *
 *   - cancel refused  → nothing changed; the refusal is thrown as-is.
 *   - submit refused  → the ORIGINAL claim is resubmitted (same add / drop /
 *     bid — valid a moment ago) and moved back to its place; the error says
 *     "your claim wasn't changed". If even that is refused, the error says so
 *     in words: the old claim is cancelled and the new one was refused —
 *     never a silent loss (CLAUDE.md "never let 'nothing happened' mean 'it
 *     worked'").
 *   - reorder refused → the edit STANDS (new bid saved) and the result says
 *     the claim is now last, with why; not thrown, because the edit happened.
 *
 * A one-transaction edit verb is PROGRESS F417 (a migration's job).
 *
 * Pure over INJECTED steps and ids: no fetch, no clock, no random (the
 * `src/lib/leagues/**` fences) — the hook mints every `action_id` ONCE per
 * edit gesture, so re-running the same edit replays each step instead of
 * repeating it.
 */
import { LeagueActionError } from './client-fetch'
import type { CancelClaimResult, ReorderClaimsResult, SubmitClaimResult } from './waivers-service'

export interface WaiverClaimEditSteps {
  cancel(claimId: string, body: { action_id: string; reason?: string }): Promise<CancelClaimResult>
  submit(body: {
    team_id: string
    add_player_id: string
    drop_player_id: string | null
    faab_bid: number
    action_id: string
    reason?: string
  }): Promise<SubmitClaimResult>
  reorder(claimId: string, body: { claim_order: number; action_id: string; reason?: string }): Promise<ReorderClaimsResult>
}

/** The claim as it stands (from `GET …/waivers`). */
export interface WaiverClaimEditOriginal {
  id: string
  team_id: string
  add_player_id: string
  drop_player_id: string | null
  faab_bid: number
  claim_order: number
}

export interface WaiverClaimEditChange {
  /** The new drop (null = no drop). */
  drop_player_id: string | null
  faab_bid: number
  /** Optional (Q66); only a commissioner's receipts store it. */
  reason?: string
}

/** One `action_id` per step, minted once per edit gesture. */
export interface WaiverClaimEditIds {
  cancel: string
  submit: string
  reorder: string
  restore: string
  restoreReorder: string
}

export interface WaiverClaimEditResult {
  /** The new claim (a new id — the old one is cancelled). */
  claim: SubmitClaimResult
  /** True when the new claim sits where the old one did. */
  kept_place: boolean
  /** Why it did not keep its place (the reorder's refusal), else null. */
  kept_place_why: string | null
}

export type WaiverClaimEditStage = 'cancel' | 'submit'

export class WaiverClaimEditError extends LeagueActionError {
  stage: WaiverClaimEditStage
  /** For `stage: 'submit'`: whether the original claim was put back. */
  restored: boolean
  constructor(stage: WaiverClaimEditStage, restored: boolean, message: string, cause: unknown) {
    const status = cause instanceof LeagueActionError ? cause.status : 500
    const fieldErrors = cause instanceof LeagueActionError ? cause.fieldErrors : undefined
    super(status, message, fieldErrors)
    this.name = 'WaiverClaimEditError'
    this.stage = stage
    this.restored = restored
  }
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

export async function runWaiverClaimEdit(
  steps: WaiverClaimEditSteps,
  original: WaiverClaimEditOriginal,
  change: WaiverClaimEditChange,
  ids: WaiverClaimEditIds,
): Promise<WaiverClaimEditResult> {
  const reason = change.reason !== undefined && change.reason.trim() !== '' ? { reason: change.reason } : {}

  try {
    await steps.cancel(original.id, { action_id: ids.cancel, ...reason })
  } catch (cause) {
    throw new WaiverClaimEditError('cancel', false, messageOf(cause), cause)
  }

  let claim: SubmitClaimResult
  try {
    claim = await steps.submit({
      team_id: original.team_id,
      add_player_id: original.add_player_id,
      drop_player_id: change.drop_player_id,
      faab_bid: change.faab_bid,
      action_id: ids.submit,
      ...reason,
    })
  } catch (cause) {
    // Put the original back where it was.
    let restored = false
    let restoredPlace = true
    try {
      const back = await steps.submit({
        team_id: original.team_id,
        add_player_id: original.add_player_id,
        drop_player_id: original.drop_player_id,
        faab_bid: original.faab_bid,
        action_id: ids.restore,
        ...reason,
      })
      restored = true
      if (back.claim.claim_order !== original.claim_order) {
        restoredPlace = await steps
          .reorder(back.claim.id, { claim_order: original.claim_order, action_id: ids.restoreReorder, ...reason })
          .then(() => true, () => false)
      }
    } catch {
      restored = false
    }
    throw new WaiverClaimEditError(
      'submit',
      restored,
      restored
        ? `Your claim wasn’t changed${restoredPlace ? '' : ' (it is now last in your list)'} — ${messageOf(cause)}`
        : `Your old claim was cancelled and the new one was refused — ${messageOf(cause)}`,
      cause,
    )
  }

  if (claim.claim.claim_order === original.claim_order) {
    return { claim, kept_place: true, kept_place_why: null }
  }
  try {
    await steps.reorder(claim.claim.id, { claim_order: original.claim_order, action_id: ids.reorder, ...reason })
    return { claim, kept_place: true, kept_place_why: null }
  } catch (cause) {
    return { claim, kept_place: false, kept_place_why: messageOf(cause) }
  }
}
