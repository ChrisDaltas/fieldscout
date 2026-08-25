/**
 * Commissioner-control request descriptors — the PURE wiring between the
 * §8.7 panel (M2 task L.B3.3) and the L.B2.3 routes (D114's one dispatch
 * pipeline). Every panel action maps to exactly one descriptor here, so
 * "which route, which body" is falsifiable without a socket — the ops-layer
 * pins assert each control's path + body shape (incl. the force-pick
 * `action_id` REQUIRED-wire-side contract and the R160 `to_pick_number = 0`
 * full rewind).
 *
 * Doctrine carried:
 *  - every body targets the panel's draft EXPLICITLY (`draft_id`) — the room
 *    knows its draft, so the active-draft default never has to guess;
 *  - `reason` is optional on the M2 verbs (D114(1): accept + validate + store
 *    nowhere — F32/F40) and REQUIRED where the task text mandates it: the
 *    post-start order dispatch (D114(3) — `orderRequest` takes it
 *    non-optionally) and, since L.C2.2, the four AUCTION commissioner verbs
 *    (reverse-bid / budget / cancel-nomination / end — same structural shape);
 *  - `force-pick` carries a caller-minted `action_id` (D68(1)/D114(4): one
 *    UUID per panel submit; a retry replays server-side as E2). The MINTING
 *    is the hook's (entropy is injected, never read here).
 */

import { draftVerbPath } from './use-draft-action-path'

export interface ControlRequest {
  /** Route path (POST unless stated on the builder). */
  path: string
  body: Record<string, unknown>
}

const reasonField = (reason: string | undefined): Record<string, unknown> =>
  reason !== undefined && reason.trim().length > 0 ? { reason: reason.trim() } : {}

/** POST …/draft/pause — ONE route for both verbs (`action` in body). */
export function pauseResumeRequest(
  leagueId: string | null,
  draftId: string,
  action: 'pause' | 'resume',
  reason?: string,
): ControlRequest {
  return {
    // MP.6c: the ONE control verb a standalone practice room can send
    // (§8.8's E59 resume path). `null` ⇒ `/api/mocks/[mockId]/pause`; every
    // other control in this file stays league-only, because §8.7 is a
    // commissioner surface and a mock has no commissioner (D110(1)).
    path: draftVerbPath(leagueId, draftId, 'pause'),
    body: { draft_id: draftId, action, ...reasonField(reason) },
  }
}

/** The auction's three timers (§7.3.8 / §8.7's timer row — 087's set_clock
 *  arm; L.C2.2). Each omitted key means "unchanged" at the RPC. */
export interface AuctionClockTimers {
  nominationSeconds?: number
  bidSeconds?: number
  antiSnipeSeconds?: number
}

/** POST …/draft/clock — the E15 dedicated verb (D114(2)). `pickTimerSeconds`
 *  is `null` for an auction-only edit (an auction has no pick clock — the
 *  RPC refuses one), and `auction` carries the auction timers (L.C2.2). */
export function setClockRequest(
  leagueId: string,
  draftId: string,
  pickTimerSeconds: number | null,
  extendCurrent: boolean,
  reason?: string,
  auction?: AuctionClockTimers,
): ControlRequest {
  return {
    path: `/api/leagues/${leagueId}/draft/clock`,
    body: {
      draft_id: draftId,
      ...(pickTimerSeconds !== null ? { pick_timer_seconds: pickTimerSeconds } : {}),
      ...(extendCurrent ? { extend_current: true } : {}),
      ...(auction?.nominationSeconds !== undefined
        ? { nomination_seconds: auction.nominationSeconds }
        : {}),
      ...(auction?.bidSeconds !== undefined ? { bid_seconds: auction.bidSeconds } : {}),
      ...(auction?.antiSnipeSeconds !== undefined
        ? { anti_snipe_seconds: auction.antiSnipeSeconds }
        : {}),
      ...reasonField(reason),
    },
  }
}

/**
 * POST …/draft/undo — single (`toPickNumber` null ⇒ body omits the field;
 * the RPC undoes the highest live pick) or cascade (`toPickNumber` = the
 * highest pick number KEPT; 0 is the R160 full rewind and is legal).
 */
export function undoRequest(
  leagueId: string,
  draftId: string,
  toPickNumber: number | null,
  reason?: string,
): ControlRequest {
  return {
    path: `/api/leagues/${leagueId}/draft/undo`,
    body: {
      draft_id: draftId,
      ...(toPickNumber !== null ? { to_pick_number: toPickNumber } : {}),
      ...reasonField(reason),
    },
  }
}

/** POST …/draft/reassign — new team and/or corrected player for one pick.
 *  `price` is the auction's RE-ENTERED cost (D142 — L.C2.2; 087's priced
 *  arm); omitted on snake and on an auction same-team edit. */
export function reassignRequest(
  leagueId: string,
  draftId: string,
  pickId: string,
  next: { teamId?: string; playerId?: string; price?: number },
  reason?: string,
): ControlRequest {
  return {
    path: `/api/leagues/${leagueId}/draft/reassign`,
    body: {
      draft_id: draftId,
      pick_id: pickId,
      ...(next.teamId !== undefined ? { team_id: next.teamId } : {}),
      ...(next.playerId !== undefined ? { player_id: next.playerId } : {}),
      ...(next.price !== undefined ? { price: next.price } : {}),
      ...reasonField(reason),
    },
  }
}

/** POST …/draft/force-pick — `actionId` is REQUIRED wire-side (D114(4));
 *  the hook mints one per submit, this builder only carries it. */
export function forcePickRequest(
  leagueId: string,
  draftId: string,
  playerId: string,
  actionId: string,
  reason?: string,
): ControlRequest {
  return {
    path: `/api/leagues/${leagueId}/draft/force-pick`,
    body: {
      draft_id: draftId,
      player_id: playerId,
      action_id: actionId,
      ...reasonField(reason),
    },
  }
}

/** POST …/draft/move-player — move a drafted player between teams. `price`
 *  is the auction's RE-ENTERED cost (D142 — L.C2.2; 087's priced arm). */
export function movePlayerRequest(
  leagueId: string,
  draftId: string,
  playerId: string,
  fromTeam: string,
  toTeam: string,
  reason?: string,
  price?: number,
): ControlRequest {
  return {
    path: `/api/leagues/${leagueId}/draft/move-player`,
    body: {
      draft_id: draftId,
      player_id: playerId,
      from_team: fromTeam,
      to_team: toTeam,
      ...(price !== undefined ? { price } : {}),
      ...reasonField(reason),
    },
  }
}

/** POST …/draft/reset — the hard-confirm wipe (069 owns the semantics). */
export function resetRequest(
  leagueId: string,
  draftId: string,
  reason?: string,
): ControlRequest {
  return {
    path: `/api/leagues/${leagueId}/draft/reset`,
    body: { draft_id: draftId, ...reasonField(reason) },
  }
}

// ---------------------------------------------------------------------------
// L.C2.2 — the AUCTION commissioner verbs (§8.7's auction rows over the
// L.C2.2 routes; spec §15.2 via the C40 erratum). `reason` is REQUIRED on
// all four (the D114(1) carve-out — the order dispatch's treatment), so the
// builders take it non-optionally and send it trimmed: an empty reason
// reaches the route and 400s there, exactly like `orderRequest`.
// ---------------------------------------------------------------------------

/** POST …/draft/reverse-bid — Manual Edit Mode's "Reset pick" (D142(a)). */
export function reverseWonBidRequest(
  leagueId: string,
  draftId: string,
  pickId: string,
  reason: string,
): ControlRequest {
  return {
    path: `/api/leagues/${leagueId}/draft/reverse-bid`,
    body: { draft_id: draftId, pick_id: pickId, reason: reason.trim() },
  }
}

/** POST …/draft/budget — §8.7's budget editor (E28 in the RPC; not
 *  pause-gated). `actionId` is REQUIRED wire-side (D68(1)/D114(4), the
 *  force-pick contract — 099/AP.6/E69): a retried POST replays server-side
 *  as E2 instead of double-charging (F82, discharged). */
export function adjustBudgetRequest(
  leagueId: string,
  draftId: string,
  teamId: string,
  delta: number,
  actionId: string,
  reason: string,
): ControlRequest {
  return {
    path: `/api/leagues/${leagueId}/draft/budget`,
    body: { draft_id: draftId, team_id: teamId, delta, action_id: actionId, reason: reason.trim() },
  }
}

/** POST …/draft/cancel-nomination — cancel-and-renominate (D143; paused only). */
export function cancelNominationRequest(
  leagueId: string,
  draftId: string,
  reason: string,
): ControlRequest {
  return {
    path: `/api/leagues/${leagueId}/draft/cancel-nomination`,
    body: { draft_id: draftId, reason: reason.trim() },
  }
}

/** POST …/draft/end — C41's end-as-is (terminal; the hard confirm is the UI's). */
export function endDraftRequest(
  leagueId: string,
  draftId: string,
  reason: string,
): ControlRequest {
  return {
    path: `/api/leagues/${leagueId}/draft/end`,
    body: { draft_id: draftId, reason: reason.trim() },
  }
}

/**
 * PATCH …/draft — the post-start order dispatch (E31). `reason` is
 * REQUIRED here (D114(3): the route 400s without it on a live/paused
 * draft) — the builder's signature makes the requirement structural.
 * NOTE: this is the one PATCH in the family (the rest POST).
 *
 * `draftId` (MS.7 — D222/R468): this was the ONE builder in the family
 * whose body carried no draft id (measured 11/11 for the rest), which is
 * exactly how a mock room's order edit resolved the league's REAL draft
 * (the R468 mis-target). The signature now makes the target structural,
 * like every sibling.
 */
export function orderRequest(
  leagueId: string,
  draftId: string,
  order: readonly string[],
  reason: string,
): ControlRequest {
  return {
    path: `/api/leagues/${leagueId}/draft`,
    body: { draft_id: draftId, order: [...order], reason: reason.trim() },
  }
}

/**
 * PATCH …/members/[mid] — the §8.7 "Toggle autopick for any team" control
 * (L.B1.7's RPC, commissioner path; F33's members-PATCH verb). One verb per
 * request — the body carries ONLY `is_autodraft`.
 */
export function memberAutodraftRequest(
  leagueId: string,
  memberId: string,
  on: boolean,
): ControlRequest {
  return {
    path: `/api/leagues/${leagueId}/members/${memberId}`,
    body: { is_autodraft: on },
  }
}
