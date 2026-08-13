/**
 * Draft-chat doctrine — the PURE half of the chat pane (M2 task L.B3.3;
 * spec §8.8 draft chat, §16.2 draft-chat, §16.3 "system posts visible to the
 * room"; D99 — chat is `league_chat` + `context`/`is_system`; D109(2) — the
 * broadcast payload is id/user_id/message/context/is_system/created_at).
 *
 * Colocated ops split (the use-draft-ops.ts precedent): no client, no React.
 * Chat rows arrive two ways — the pane's own RLS SELECT and the room
 * channel's `league_chat` broadcast — and both meet here: the reducer
 * dedupes by `id` (broadcast rows CARRY their id, unlike pick hints), so a
 * member's own INSERT echo and the broadcast of it collapse to one row.
 *
 * RENDER SHAPES (the D108(15) contract — `league_chat.user_id` is
 * ON DELETE SET NULL for ALL rows, so BOTH arms below are legal data):
 *  - `is_system = TRUE`  → a SYSTEM post. Renders actorless BY SHAPE — the
 *    acting commissioner (or the tick, `user_id` NULL) is named in the
 *    message text itself (069's `draft_actor_name()`); the row never renders
 *    an author line, and the treatment is distinct + non-hideable (§16.3).
 *  - `is_system = FALSE`, `user_id` NULL → an AUTHORLESS ORDINARY message: a
 *    deleted account's rows keep their text (R137) — the "former member"
 *    author fallback renders, never a crash, never a system treatment.
 *  - `is_system = FALSE`, `user_id` present → an ordinary member message;
 *    the author label follows the §16.4 identity rule (Team — @username;
 *    never an email).
 */

// ---------------------------------------------------------------------------
// Row + broadcast shapes
// ---------------------------------------------------------------------------

/** The chat row slice the pane renders — identical to the D109(2) broadcast
 *  payload (id/user_id/message/context/is_system/created_at), so broadcast
 *  records ARE rows (no hint reconciliation needed, unlike picks). */
export interface DraftChatRow {
  id: string
  user_id: string | null
  message: string
  context: string | null
  is_system: boolean | null
  created_at: string | null
}

/** Shape guard for the broadcast record (malformed = dropped, not applied —
 *  chat is not room state, so doubt costs a missing bubble until the next
 *  join refetch, never a wrong board). */
export function isChatRecord(record: unknown): record is DraftChatRow {
  if (typeof record !== 'object' || record === null) return false
  const row = record as Partial<DraftChatRow>
  return typeof row.id === 'string' && typeof row.message === 'string'
}

// ---------------------------------------------------------------------------
// Reducer — broadcast → cached rows
// ---------------------------------------------------------------------------

/** Bounded read window (latest N by created_at; the pane renders ascending).
 *  A window, not the table — the room only ever needs the recent scroll. */
export const DRAFT_CHAT_WINDOW = 200

function rowSortKey(row: DraftChatRow): string {
  // created_at then id — a stable total order (rows born in one txn share a
  // frozen created_at; id breaks the tie deterministically).
  return `${row.created_at ?? ''}|${row.id}`
}

/**
 * Apply one `league_chat` broadcast to the cached rows. Same reference back
 * when nothing changed (the reducer contract the room state uses):
 *  - malformed record → unchanged (dropped);
 *  - a context that isn't this draft's → unchanged (070 routes by topic so
 *    this can't normally arrive, but a defensive drop is free);
 *  - an id already held → unchanged (the own-INSERT echo / replay dedupe);
 *  - otherwise append, kept sorted by (created_at, id).
 */
export function reduceChatEvent(
  rows: readonly DraftChatRow[],
  record: unknown,
  draftContext: string,
): readonly DraftChatRow[] {
  if (!isChatRecord(record)) return rows
  if (record.context !== draftContext) return rows
  if (rows.some((row) => row.id === record.id)) return rows
  const next = [...rows, record]
  next.sort((a, b) => (rowSortKey(a) < rowSortKey(b) ? -1 : 1))
  return next
}

// ---------------------------------------------------------------------------
// Render model — the D108(15) both-arms contract
// ---------------------------------------------------------------------------

export type ChatItemKind = 'system' | 'member' | 'former-member'

export interface ChatItemView {
  kind: ChatItemKind
  /** Author line; null for system posts (actorless BY SHAPE — the actor is
   *  named in the message text, D108(15)). */
  authorLabel: string | null
  message: string
  /** True when the viewer authored the row (alignment/emphasis only). */
  mine: boolean
}

/** The authorless-ordinary fallback label (D108(15): a deleted account's
 *  ordinary rows keep their text with `user_id` NULL). */
export const FORMER_MEMBER_LABEL = 'Former member'

/**
 * Author labels by user id, per the §16.4 identity rule: *Team — @username*
 * (never an email; no name is stored to render). A member with no franchise
 * renders the bare @username.
 */
export function chatAuthorsById(
  members: ReadonlyArray<{
    user_id: string | null
    team_id: string | null
    profiles: { username: string } | null
  }>,
  teams: ReadonlyArray<{ id: string; name: string }>,
): ReadonlyMap<string, string> {
  const teamNameById = new Map(teams.map((t) => [t.id, t.name]))
  const authors = new Map<string, string>()
  for (const member of members) {
    if (!member.user_id || !member.profiles) continue
    const teamName = member.team_id ? teamNameById.get(member.team_id) : undefined
    authors.set(
      member.user_id,
      teamName ? `${teamName} — @${member.profiles.username}` : `@${member.profiles.username}`,
    )
  }
  return authors
}

/**
 * The render model for one chat row — the D108(15) both-arms contract as a
 * testable unit:
 *  - system rows are actorless whatever `user_id` holds (commissioner or
 *    tick-NULL alike — the text names the actor);
 *  - authorless ORDINARY rows (user_id NULL, is_system FALSE) render the
 *    former-member fallback with their text intact;
 *  - ordinary rows with an author unknown to the members map (departed but
 *    not deleted) render the former-member fallback too — the map is the
 *    room's whole identity surface, and "not in this league anymore" is the
 *    same honest label.
 */
export function chatItemView(
  row: DraftChatRow,
  authors: ReadonlyMap<string, string>,
  viewerUserId: string | null,
): ChatItemView {
  if (row.is_system === true) {
    return { kind: 'system', authorLabel: null, message: row.message, mine: false }
  }
  if (row.user_id === null) {
    return {
      kind: 'former-member',
      authorLabel: FORMER_MEMBER_LABEL,
      message: row.message,
      mine: false,
    }
  }
  const label = authors.get(row.user_id)
  if (label === undefined) {
    return {
      kind: 'former-member',
      authorLabel: FORMER_MEMBER_LABEL,
      message: row.message,
      mine: row.user_id === viewerUserId,
    }
  }
  return {
    kind: 'member',
    authorLabel: label,
    message: row.message,
    mine: row.user_id === viewerUserId,
  }
}

// ---------------------------------------------------------------------------
// Composer guard (the 065 policy's 1..500 bound, client-side courtesy)
// ---------------------------------------------------------------------------

/** The 065 INSERT policy's length ceiling (`char_length BETWEEN 1 AND 500`). */
export const CHAT_MAX_LENGTH = 500

/** True when the trimmed draft is sendable (1..500 chars — the policy bound;
 *  the policy is the backstop, this is the friendly gate). */
export function chatDraftSendable(text: string): boolean {
  const trimmed = text.trim()
  return trimmed.length >= 1 && trimmed.length <= CHAT_MAX_LENGTH
}
