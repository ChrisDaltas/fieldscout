/**
 * "Add players to share it." — the line a "List created" toast carries when
 * the new list has no players yet (plan C4; readiness F9).
 *
 * Community shows only lists with players in them (`shownInCommunityQuery`:
 * nobody's empty board appears), so a public list saved empty would
 * otherwise say "List created" and then never show up there. The hint says
 * why, and what to do. Only while Community is on (`community`, from
 * `featureFlags.community`) — with it off nothing is shared through it and
 * the toast stays as it was — and never for a private list, which players
 * don't make shareable.
 */
export const ADD_PLAYERS_TO_SHARE = 'Add players to share it.'

export function emptyListShareHint(
  list: { players: number; isPrivate: boolean },
  community: boolean,
): string | null {
  return community && !list.isPrivate && list.players === 0 ? ADD_PLAYERS_TO_SHARE : null
}
