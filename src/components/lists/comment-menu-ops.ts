import { featureFlags } from '@/lib/feature-flags'

/**
 * Comments: Delete, Comments on / off, older comments (Community launch plan
 * C1) — testers get them on day one of Community, so they ride its switch.
 * While `community` is off every comment box — the phone List view's, desktop
 * Lists' and the share page's — is exactly as it was: no ⋯, no On / Off, no
 * "Show older comments". This is the one place that says so.
 */
export function commentControlsOn(): boolean {
  return featureFlags.community
}

/**
 * A comment row's ⋯ menu — phone comments sheet and desktop Comments tab
 * alike (Community launch plan C1, readiness B1).
 *
 * The menu holds a list of items so the next one can join it: Report (C10)
 * goes in beside Delete. A viewer with no item gets no ⋯ at all — an item
 * someone can't use is left out, never shown greyed.
 *
 * **Delete** is offered to whoever wrote the comment and to the list's owner
 * — the same two people `remove_list_comment` (migration 213) and the DELETE
 * route's fallback before it allow. A FieldScout admin's Remove lives in
 * Admin › Reports (C10), not in this menu.
 */

export type CommentMenuItem = 'delete'

export function commentMenuItems({
  viewerId,
  authorId,
  listOwned,
}: {
  /** The signed-in viewer, or none when signed out. */
  viewerId: string | null | undefined
  authorId: string
  /** The viewer owns the list the comment is on. */
  listOwned: boolean
}): CommentMenuItem[] {
  if (!viewerId) return []
  const items: CommentMenuItem[] = []
  if (authorId === viewerId || listOwned) items.push('delete')
  return items
}

/** The words of Delete and its confirm, on both layouts. */
export const DELETE_COMMENT = {
  item: 'Delete comment',
  title: 'Delete this comment?',
  body: 'It comes off the list for everyone. You can’t undo this.',
  cancel: 'Cancel',
  confirm: 'Delete',
  done: 'Comment deleted',
  failed: 'Couldn’t delete that comment',
} as const

type Notify = (toast: { title: string; description?: string; variant?: 'destructive' }) => unknown

/**
 * Delete, once confirmed: `useDeleteComment` takes the comment out of the
 * thread at once and puts it back if the server refuses; the answer reaches
 * the viewer in the normal toast — "Comment deleted", or the refusal in the
 * server's own words with the comment still there.
 */
export function confirmCommentDelete(
  remove: { mutate: (commentId: string, opts: { onSuccess: () => void; onError: (error: Error) => void }) => void },
  commentId: string,
  notify: Notify,
) {
  remove.mutate(commentId, {
    onSuccess: () => notify({ title: DELETE_COMMENT.done }),
    onError: (error) => notify({ title: DELETE_COMMENT.failed, description: error.message, variant: 'destructive' }),
  })
}

/** "Comments are off" — what a reader sees, and what the owner sees. */
export function commentsOffCopy(listOwned: boolean): string {
  return listOwned
    ? 'You turned comments off. Only you can see these, and nobody can add new ones.'
    : 'Comments are turned off on this list.'
}
