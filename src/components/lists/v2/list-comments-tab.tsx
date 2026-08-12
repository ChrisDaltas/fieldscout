'use client'

import * as React from 'react'
import Link from 'next/link'

import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { Input } from '@/components/ui/input'
import { UserAvatar } from '@/components/ui/user-avatar'
import { useAddComment, useComments } from '@/hooks/use-comments'
import { MAX_COMMENT_LEN } from '@/types/schemas/lists'

import { formatRelative } from './list-stats'

/**
 * Lists v2 — the **Comments** tab (`screens/detail-tab-comments.png`).
 *
 * Composer (avatar, single-line field, `Post`) then the thread: avatar,
 * `@handle` + relative time, body, and a like control with its count.
 *
 * Two notes on what is and is not wired:
 *
 * * **Likes are display-only.** The design shows a heart and a count on every
 *   comment; `list_comments` carries no per-comment like, and adding one is a
 *   schema change this build may not make. The count renders as 0 and the
 *   control is inert rather than optimistically lying about a write.
 * * A failed read renders as an **error**, never as "no comments yet" — the
 *   false-empty-state shape CLAUDE.md calls out by name.
 *
 * ## Who gets a composer (LV.6)
 *
 * The thread reads for everyone; **writing needs two conditions and the tab
 * asks for both explicitly.** `signedIn` came in with the public share view,
 * which is the only Lists surface that renders to a stranger — a composer that
 * 401s on submit is the same lie as a drag that snaps back. `commentsEnabled`
 * is `lists.comments_enabled`, which this tab previously ignored: the app panel
 * showed a working-looking composer on a list whose owner had turned comments
 * off, and the POST would have been refused. Both callers now pass the truth.
 */

interface CommentsTabProps {
  listId: string
  viewer: { username: string | null; avatarUrl: string | null }
  /** A signed-out viewer reads the thread and gets a sign-in link, not a field. */
  signedIn?: boolean
  /** `lists.comments_enabled` — the owner's switch. */
  commentsEnabled?: boolean
}

export function ListCommentsTab({
  listId,
  viewer,
  signedIn = true,
  commentsEnabled = true,
}: CommentsTabProps) {
  const [text, setText] = React.useState('')
  const comments = useComments(listId)
  const addComment = useAddComment(listId)

  const post = () => {
    const body = text.trim()
    if (!body || addComment.isPending) return
    addComment.mutate(
      { body },
      {
        onSuccess: () => setText(''),
      },
    )
  }

  return (
    <div className="flex max-w-[576px] flex-col gap-3">
      {!commentsEnabled ? (
        <p className="border border-ink bg-white px-2.5 py-2 text-[11px] font-semibold text-n-3">
          Comments are turned off on this list.
        </p>
      ) : !signedIn ? (
        <div className="flex flex-wrap items-center gap-2 border border-ink bg-white px-2.5 py-2">
          <span className="mr-auto text-[11px] font-medium text-n-3">
            Sign in to join the discussion.
          </span>
          <Button asChild variant="blue" size="sm">
            <Link href="/login">Sign in</Link>
          </Button>
        </div>
      ) : (
        <div className="flex gap-2">
          <UserAvatar
            src={viewer.avatarUrl}
            name={viewer.username}
            className="mt-0.5 h-[21px] w-[21px] shrink-0"
            fallbackClassName="text-[9px]"
          />
          <Input
            value={text}
            maxLength={MAX_COMMENT_LEN}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') post()
            }}
            placeholder="Add a comment…"
            aria-label="Add a comment"
            className="h-btn-sm min-w-0 flex-1 text-[12px]"
          />
          <Button
            variant="blue"
            size="sm"
            onClick={post}
            disabled={!text.trim() || addComment.isPending}
          >
            <Icon name="send" size={13} /> Post
          </Button>
        </div>
      )}

      {addComment.isError && (
        <p className="text-[11px] font-semibold text-negative-strong">
          Could not post that comment. {addComment.error.message}
        </p>
      )}

      {comments.isPending && (
        <p className="text-[11px] font-semibold text-n-3">Loading comments…</p>
      )}

      {comments.isError && (
        <p className="text-[11px] font-semibold text-negative-strong">
          Comments could not be loaded. {comments.error.message}
        </p>
      )}

      {comments.data?.comments.map((comment) => (
        <div key={comment.id} className="flex gap-2">
          <UserAvatar
            src={comment.author.avatar_url}
            name={comment.author.username}
            className="mt-0.5 h-[21px] w-[21px] shrink-0"
            fallbackClassName="text-[9px]"
          />
          <div className="min-w-0">
            <div className="flex items-baseline gap-1.5">
              <Link
                href={`/u/${comment.author.username}`}
                className="text-[11px] font-bold text-ink underline decoration-transparent underline-offset-2 transition-colors hover:decoration-current"
              >
                @{comment.author.username}
              </Link>
              <span className="text-[10px] font-medium text-n-3">
                {formatRelative(comment.created_at)}
              </span>
            </div>
            <p className="mt-0.5 text-[11.5px] font-medium leading-snug">{comment.body}</p>
            <span
              title="Comment likes are not stored yet"
              className="mt-1 inline-flex items-center gap-1 text-[10px] font-medium text-n-3"
            >
              <Icon name="like" size={11} />
              <span className="fs-num">0</span>
            </span>
          </div>
        </div>
      ))}

      {comments.data && comments.data.comments.length === 0 && (
        <p className="text-[11px] font-semibold text-n-3">No comments yet.</p>
      )}
    </div>
  )
}
