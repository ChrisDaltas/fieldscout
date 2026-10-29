'use client'

import * as React from 'react'
import Link from 'next/link'

import { UsernameLink } from '@/components/shared/username-link'
import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { Input } from '@/components/ui/input'
import { UserAvatar } from '@/components/ui/user-avatar'
import { useCommentCooldown } from '@/hooks/use-comment-cooldown'
import { CommentRequestError, useAddComment, useComments } from '@/hooks/use-comments'
import { toast } from '@/hooks/use-toast'
import { commentWaitCopy } from '@/lib/rate-limit/comment-limit'
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
 *
 * ## The comment limit (migration 213 — 5 a minute)
 *
 * Once the poster has used his five, `Post` is held with "You can comment
 * again in 20s", counting down; if the server refuses first, its wait is held
 * instead. A refused or failed post shows in the ink toast and the typed text
 * stays in the field.
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
  const cooldown = useCommentCooldown({ active: commentsEnabled && signedIn })
  const holding = cooldown.waitSeconds > 0

  const post = () => {
    const body = text.trim()
    if (!body || addComment.isPending || holding) return
    addComment.mutate(
      { body },
      {
        onSuccess: (created) => {
          setText('')
          cooldown.notePosted(created.created_at)
        },
        onError: (error) => {
          if (error instanceof CommentRequestError && error.retryAfterSeconds !== null) {
            cooldown.noteRefused(error.retryAfterSeconds)
          }
          toast({ title: 'That comment wasn’t posted', description: error.message, variant: 'destructive' })
        },
      },
    )
  }

  return (
    <div className="flex max-w-[576px] flex-col gap-3">
      {!commentsEnabled ? (
        <p className="rounded-xl bg-surface-sunken px-3 py-2.5 text-[11px] font-medium text-n-3">
          Comments are turned off on this list.
        </p>
      ) : !signedIn ? (
        <div className="flex flex-wrap items-center gap-2 rounded-xl bg-surface-sunken px-3 py-2">
          <span className="mr-auto text-[11px] font-medium text-n-3">
            Sign in to join the discussion.
          </span>
          <Button asChild variant="blue" size="sm">
            <Link href="/login">Sign in</Link>
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <UserAvatar
            src={viewer.avatarUrl}
            name={viewer.username}
            className="h-6 w-6 shrink-0"
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
            className="h-input min-w-0 flex-1 rounded-pill px-3"
          />
          <Button
            variant="blue"
            size="md"
            onClick={post}
            disabled={!text.trim() || addComment.isPending || holding}
          >
            <Icon name="send" size={12} /> Post
          </Button>
        </div>
      )}

      {holding && commentsEnabled && signedIn && (
        <p aria-live="polite" className="-mt-1 pl-8 text-[10px] font-medium text-n-6" data-comment-wait>
          {commentWaitCopy(cooldown.waitSeconds)}
        </p>
      )}

      {comments.isPending && (
        <p className="py-4 text-center text-[11px] font-medium text-n-6">Loading comments…</p>
      )}

      {comments.isError && (
        <p className="text-[11px] font-medium text-negative-strong">
          Comments could not be loaded. {comments.error.message}
        </p>
      )}

      {comments.data?.comments.map((comment) => (
        <div key={comment.id} className="flex gap-2.5 border-t border-n-4 pt-3">
          <UserAvatar
            src={comment.author.avatar_url}
            name={comment.author.username}
            className="mt-0.5 h-6 w-6 shrink-0"
            fallbackClassName="text-[9px]"
          />
          <div className="min-w-0">
            <div className="flex items-baseline gap-1.5">
              <UsernameLink username={comment.author.username} className="text-[11px] font-semibold text-ink" />
              <span className="text-[10px] font-medium text-n-6">
                {formatRelative(comment.created_at)}
              </span>
            </div>
            <p className="mt-0.5 text-[12px] font-medium leading-snug text-n-2">{comment.body}</p>
            <span
              title="Comment likes are not stored yet"
              className="mt-1 inline-flex items-center gap-1 text-[10px] font-medium text-n-6"
            >
              <Icon name="like" size={11} />
              <span className="fs-num">0</span>
            </span>
          </div>
        </div>
      ))}

      {comments.data && comments.data.comments.length === 0 && (
        <p className="py-4 text-center text-[11px] font-medium text-n-6">No comments yet.</p>
      )}
    </div>
  )
}
