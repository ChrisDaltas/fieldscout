'use client'

import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'

import type { CreateCommentInput } from '@/types/schemas/lists'
import type { ListComment, Profile } from '@/types/database'

export interface CommentWithAuthor extends ListComment {
  author: Pick<
    Profile,
    'id' | 'username' | 'avatar_url' | 'cred_score' | 'is_pro'
  >
}

interface CommentsResponse {
  comments: CommentWithAuthor[]
  pagination: { page: number; pageSize: number; total: number; hasMore: boolean }
}

/**
 * A failed comments request: the server's own words, its HTTP status and —
 * for 213's comment limit (a 429) — how long to wait, from the body's
 * `retry_after_seconds` or the `Retry-After` header.
 */
export class CommentRequestError extends Error {
  readonly status: number
  readonly retryAfterSeconds: number | null

  constructor(message: string, status: number, retryAfterSeconds: number | null) {
    super(message)
    this.name = 'CommentRequestError'
    this.status = status
    this.retryAfterSeconds = retryAfterSeconds
  }
}

function retryAfterOf(res: Response, body: { retry_after_seconds?: unknown }): number | null {
  if (res.status !== 429) return null
  const fromBody = Number(body.retry_after_seconds)
  if (Number.isFinite(fromBody) && fromBody >= 1) return Math.ceil(fromBody)
  const fromHeader = Number(res.headers.get('Retry-After'))
  return Number.isFinite(fromHeader) && fromHeader >= 1 ? Math.ceil(fromHeader) : null
}

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: unknown; retry_after_seconds?: unknown }
    const message = typeof body.error === 'string' && body.error ? body.error : `Request failed with ${res.status}`
    throw new CommentRequestError(message, res.status, retryAfterOf(res, body))
  }
  return (await res.json()) as T
}

export const commentsKeys = {
  list: (listId: string, page: number, pageSize: number) =>
    ['comments', listId, page, pageSize] as const,
  all: (listId: string) => ['comments', listId] as const,
}

export function useComments(
  listId: string | undefined,
  opts: { page?: number; pageSize?: number } = {},
) {
  const page = opts.page ?? 1
  const pageSize = opts.pageSize ?? 20
  return useQuery({
    queryKey: listId
      ? commentsKeys.list(listId, page, pageSize)
      : ['comments', 'undefined'],
    queryFn: () =>
      fetch(`/api/lists/${listId}/comments?page=${page}&pageSize=${pageSize}`).then(
        jsonOrThrow<CommentsResponse>,
      ),
    enabled: Boolean(listId),
    placeholderData: keepPreviousData,
  })
}

export function useAddComment(listId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateCommentInput) =>
      fetch(`/api/lists/${listId}/comments`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      }).then(jsonOrThrow<CommentWithAuthor>),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: commentsKeys.all(listId) })
    },
  })
}

export function useDeleteComment(listId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (commentId: string) =>
      fetch(`/api/lists/${listId}/comments/${commentId}`, {
        method: 'DELETE',
      }).then(jsonOrThrow<{ ok: boolean }>),

    onMutate: async (commentId) => {
      await qc.cancelQueries({ queryKey: commentsKeys.all(listId) })
      const snapshots = qc.getQueriesData<CommentsResponse>({
        queryKey: commentsKeys.all(listId),
      })
      for (const [key, value] of snapshots) {
        if (!value) continue
        qc.setQueryData<CommentsResponse>(key, {
          ...value,
          comments: value.comments.filter((c) => c.id !== commentId),
          pagination: {
            ...value.pagination,
            total: Math.max(0, value.pagination.total - 1),
          },
        })
      }
      return { snapshots }
    },
    onError: (_err, _vars, ctx) => {
      for (const [key, value] of ctx?.snapshots ?? []) {
        qc.setQueryData(key, value)
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: commentsKeys.all(listId) })
    },
  })
}
