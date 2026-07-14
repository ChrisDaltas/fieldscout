'use client'

import Link from 'next/link'
import { useState } from 'react'

import { UserAvatar } from '@/components/ui/user-avatar'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/hooks/use-auth'
import {
  type CommentWithAuthor,
  useAddComment,
  useComments,
  useDeleteComment,
} from '@/hooks/use-comments'
import { useToast } from '@/hooks/use-toast'
import { MAX_COMMENT_LEN } from '@/types/schemas/lists'

interface CommentsThreadProps {
  listId: string
  ownerId: string
  commentsEnabled: boolean
}

function formatRelative(iso: string | null): string {
  if (!iso) return ''
  const dt = new Date(iso)
  const diffMs = Date.now() - dt.getTime()
  const mins = Math.floor(diffMs / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  return new Date(iso).toLocaleDateString()
}

export function CommentsThread({ listId, ownerId, commentsEnabled }: CommentsThreadProps) {
  const { data, isLoading } = useComments(listId, { page: 1, pageSize: 50 })
  const comments = data?.comments ?? []

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2">
        <h2 className="text-h6">Comments</h2>
        <span className="fs-num text-sm font-bold text-n-3">
          {data?.pagination.total ?? 0}
        </span>
      </div>

      {commentsEnabled ? (
        <CommentComposer listId={listId} />
      ) : (
        <div className="rounded-sm border border-ink bg-white p-4 text-sm font-medium text-n-3">
          Comments are turned off on this list.
        </div>
      )}

      {isLoading ? (
        <p className="text-sm font-medium text-n-3">Loading comments…</p>
      ) : comments.length === 0 ? (
        <p className="text-sm font-medium text-n-3">No comments yet.</p>
      ) : (
        <ul className="space-y-3">
          {comments.map((comment) => (
            <CommentItem
              key={comment.id}
              listId={listId}
              ownerId={ownerId}
              comment={comment}
            />
          ))}
        </ul>
      )}
    </section>
  )
}

function CommentComposer({ listId }: { listId: string }) {
  const [body, setBody] = useState('')
  const { user } = useAuth()
  const { toast } = useToast()
  const addComment = useAddComment(listId)

  if (!user) {
    return (
      <div className="flex items-center justify-between rounded-sm border border-ink bg-white p-4">
        <p className="text-sm font-medium text-n-3">
          Sign in to join the discussion.
        </p>
        <Link
          href="/login"
          className="text-sm font-bold text-accent hover:underline"
        >
          Sign in →
        </Link>
      </div>
    )
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = body.trim()
    if (!trimmed) return
    addComment.mutate(
      { body: trimmed },
      {
        onSuccess: () => setBody(''),
        onError: (err) =>
          toast({
            title: 'Could not post',
            description: err.message,
            variant: 'destructive',
          }),
      },
    )
  }

  return (
    <form onSubmit={submit} className="space-y-2">
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={2}
        maxLength={MAX_COMMENT_LEN}
        placeholder="Add a comment…"
        className="w-full resize-none rounded-sm border border-ink bg-white px-3 py-2 text-sm font-medium text-ink transition-colors placeholder:text-n-3 focus:border-accent focus:outline-none"
      />
      <div className="flex items-center justify-between">
        <span className="fs-num text-[10px] font-semibold text-n-3">
          {body.length} / {MAX_COMMENT_LEN}
        </span>
        <Button
          type="submit"
          variant="blue"
          size="sm"
          disabled={addComment.isPending || body.trim() === ''}
        >
          {addComment.isPending ? 'Posting…' : 'Post'}
        </Button>
      </div>
    </form>
  )
}

function CommentItem({
  listId,
  ownerId,
  comment,
}: {
  listId: string
  ownerId: string
  comment: CommentWithAuthor
}) {
  const { user } = useAuth()
  const { toast } = useToast()
  const deleteComment = useDeleteComment(listId)

  const canDelete =
    user && (user.id === comment.author_id || user.id === ownerId)

  return (
    <li className="flex gap-3">
      <UserAvatar
        src={comment.author.avatar_url}
        name={comment.author.display_name ?? comment.author.username}
        className="h-8 w-8 shrink-0"
      />
      <div className="min-w-0 flex-1 rounded-sm border border-ink bg-white px-3 py-2">
        <div className="flex items-center gap-2 text-xs font-semibold text-n-3">
          <Link
            href={`/u/${comment.author.username}`}
            className="font-bold text-ink hover:underline"
          >
            {comment.author.display_name ?? `@${comment.author.username}`}
          </Link>
          <span>·</span>
          <span>{formatRelative(comment.created_at)}</span>
          {canDelete && (
            <button
              type="button"
              onClick={() =>
                deleteComment.mutate(comment.id, {
                  onError: (err) =>
                    toast({
                      title: 'Could not delete',
                      description: err.message,
                      variant: 'destructive',
                    }),
                })
              }
              className="ml-auto text-xs font-semibold text-n-3 transition-colors hover:text-negative-strong"
            >
              Delete
            </button>
          )}
        </div>
        <p className="mt-1 whitespace-pre-wrap text-sm font-medium text-ink">
          {comment.body}
        </p>
      </div>
    </li>
  )
}
