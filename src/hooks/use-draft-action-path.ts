/**
 * WHICH URL A ROOM VERB POSTS TO — the client half of MP.6b's seam (MP task
 * MP.6c item 3; spec v2.16 §8.8; D243/D245).
 *
 * MP.6b opened `/api/mocks/[mockId]/…` for the six verbs a standalone
 * practice room needs, as thin wrappers over the SAME service functions the
 * league routes call (*"seventeen verbs, ONE resolver"*). This is that
 * decision expressed once on the client: every room hook takes
 * `leagueId: string | null` from the room's scope object and asks here.
 *
 * **Pure, so "which route" is falsifiable without a socket** — the
 * `use-draft-controls-ops` / `use-draft-auction-ops` precedent. A hook that
 * hand-rolled `/api/leagues/${leagueId}/draft/…` again would put the league
 * back into a room that may not have one, which is the whole defect MP.6c
 * exists to remove.
 */

/** The six verbs a room can send, league or standalone. */
export type DraftVerb = 'pick' | 'pause' | 'nominate' | 'bid' | 'queue'

/**
 * The POST path for one room verb.
 *
 * `leagueId === null` ⇒ the standalone arm, keyed on the MOCK's id (which is
 * the draft's id — `/app/mocks/[mockId]` and `drafts.id` are the same value,
 * MP.6/D244). `leagueId` present ⇒ the shipped league path, byte-for-byte
 * what every caller sent before (§4 rule 11: nothing league-side moves).
 */
export function draftVerbPath(
  leagueId: string | null,
  draftId: string,
  verb: DraftVerb,
): string {
  return leagueId === null
    ? `/api/mocks/${draftId}/${verb}`
    : `/api/leagues/${leagueId}/draft/${verb}`
}

/** §8.9 load-into-queue — the one verb with a second id in its path. */
export function queueFromListPath(
  leagueId: string | null,
  draftId: string,
  listId: string,
): string {
  return `${draftVerbPath(leagueId, draftId, 'queue')}/from-list/${listId}`
}
