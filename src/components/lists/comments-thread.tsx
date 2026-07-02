'use client'

import Link from 'next/link'
import { useState } from 'react'

import { UserAvatar } from '@/components/ui/user-avatar'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { useAuth } from '@/hooks/use-auth'
import {
  type CommentWithAuthor,
  useAddComment,
  useComments,
  useDeleteComment,
} from '@/hooks/use-comments'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
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
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">
          Comments
          <span className="ml-2 text-sm font-normal text-text-tertiary tabular-nums">
            {data?.pagination.total ?? 0}
          </span>
        </h2>
      </div>

      {commentsEnabled ? (
        <CommentComposer listId={listId} />
      ) : (
        <Card className="border-bg-elevated-2 bg-bg-elevated">
          <CardContent className="p-4 text-sm text-text-secondary">
            Comments are turned off on this list.
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <p className="text-sm text-text-secondary">Loading comments…</p>
      ) : comments.length === 0 ? (
        <p className="text-sm text-text-tertiary">No comments yet.</p>
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
      <Card className="border-bg-elevated-2 bg-bg-elevated">
        <CardContent className="flex items-center justify-between p-4">
          <p className="text-sm text-text-secondary">
            Sign in to join the discussion.
          </p>
          <Link
            href="/login"
            className="text-sm font-medium text-foreground hover:text-text-secondary"
          >
            Sign in →
          </Link>
        </CardContent>
      </Card>
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
        className="w-full resize-none rounded-md border border-bg-elevated-2 bg-bg-elevated-3 px-3 py-2 text-sm text-foreground placeholder:text-text-tertiary focus:border-foreground focus:outline-none"
      />
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-text-tertiary tabular-nums">
          {body.length} / {MAX_COMMENT_LEN}
        </span>
        <Button
          type="submit"
          disabled={addComment.isPending || body.trim() === ''}
          className="rounded-full font-semibold"
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
      <div className="min-w-0 flex-1 rounded-md border border-bg-elevated-2 bg-bg-elevated px-3 py-2">
        <div className="flex items-center gap-2 text-xs text-text-secondary">
          <Link
            href={`/u/${comment.author.username}`}
            className="font-semibold text-foreground hover:underline"
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
              className={cn(
                'ml-auto text-xs text-text-tertiary hover:text-destructive',
              )}
            >
              Delete
            </button>
          )}
        </div>
        <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">
          {comment.body}
        </p>
      </div>
    </li>
  )
}
