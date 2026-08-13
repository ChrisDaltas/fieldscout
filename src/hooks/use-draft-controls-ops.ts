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
 *  - `reason` is optional on every verb (D114(1): accept + validate + store
 *    nowhere — F32/F40) and REQUIRED on exactly one: the post-start order
 *    dispatch (D114(3) — `orderRequest` takes it non-optionally);
 *  - `force-pick` carries a caller-minted `action_id` (D68(1)/D114(4): one
 *    UUID per panel submit; a retry replays server-side as E2). The MINTING
 *    is the hook's (entropy is injected, never read here).
 */

export interface ControlRequest {
  /** Route path (POST unless stated on the builder). */
  path: string
  body: Record<string, unknown>
}

const reasonField = (reason: string | undefined): Record<string, unknown> =>
  reason !== undefined && reason.trim().length > 0 ? { reason: reason.trim() } : {}

/** POST …/draft/pause — ONE route for both verbs (`action` in body). */
export function pauseResumeRequest(
  leagueId: string,
  draftId: string,
  action: 'pause' | 'resume',
  reason?: string,
): ControlRequest {
  return {
    path: `/api/leagues/${leagueId}/draft/pause`,
    body: { draft_id: draftId, action, ...reasonField(reason) },
  }
}

/** POST …/draft/clock — the E15 dedicated verb (D114(2)). */
export function setClockRequest(
  leagueId: string,
  draftId: string,
  pickTimerSeconds: number,
  extendCurrent: boolean,
  reason?: string,
): ControlRequest {
  return {
    path: `/api/leagues/${leagueId}/draft/clock`,
    body: {
      draft_id: draftId,
      pick_timer_seconds: pickTimerSeconds,
      ...(extendCurrent ? { extend_current: true } : {}),
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

/** POST …/draft/reassign — new team and/or corrected player for one pick. */
export function reassignRequest(
  leagueId: string,
  draftId: string,
  pickId: string,
  next: { teamId?: string; playerId?: string },
  reason?: string,
): ControlRequest {
  return {
    path: `/api/leagues/${leagueId}/draft/reassign`,
    body: {
      draft_id: draftId,
      pick_id: pickId,
      ...(next.teamId !== undefined ? { team_id: next.teamId } : {}),
      ...(next.playerId !== undefined ? { player_id: next.playerId } : {}),
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

/** POST …/draft/move-player — move a drafted player between teams. */
export function movePlayerRequest(
  leagueId: string,
  draftId: string,
  playerId: string,
  fromTeam: string,
  toTeam: string,
  reason?: string,
): ControlRequest {
  return {
    path: `/api/leagues/${leagueId}/draft/move-player`,
    body: {
      draft_id: draftId,
      player_id: playerId,
      from_team: fromTeam,
      to_team: toTeam,
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

/**
 * PATCH …/draft — the post-start order dispatch (E31). `reason` is
 * REQUIRED here (D114(3): the route 400s without it on a live/paused
 * draft) — the builder's signature makes the requirement structural.
 * NOTE: this is the one PATCH in the family (the rest POST).
 */
export function orderRequest(
  leagueId: string,
  order: readonly string[],
  reason: string,
): ControlRequest {
  return {
    path: `/api/leagues/${leagueId}/draft`,
    body: { order: [...order], reason: reason.trim() },
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
