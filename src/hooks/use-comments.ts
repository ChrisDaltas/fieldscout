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

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error ?? `Request failed with ${res.status}`)
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
