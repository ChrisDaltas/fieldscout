'use client'

import {
  infiniteQueryOptions,
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
  type QueryKey,
} from '@tanstack/react-query'

import type { CreateCommentInput } from '@/types/schemas/lists'
import type { ListComment, Profile } from '@/types/database'

export interface CommentWithAuthor extends ListComment {
  author: Pick<
    Profile,
    'id' | 'username' | 'avatar_url' | 'cred_score' | 'is_pro'
  >
}

export interface CommentsResponse {
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
  all: (listId: string) => ['comments', listId] as const,
  thread: (listId: string, pageSize: number) => ['comments', listId, 'thread', pageSize] as const,
}

/** The API's page (`GET /api/lists/[id]/comments`): newest first. */
export const COMMENTS_PAGE_SIZE = 20

/**
 * A comment box's thread: every page read so far, newest first, once each.
 * `total` is the newest page's count (it counts live comments the viewer can
 * read); `hasMore` is the oldest page's — whether "Show older comments" has
 * anything left to read.
 */
export interface CommentsThread {
  comments: CommentWithAuthor[]
  pagination: { total: number; hasMore: boolean }
}

/** The page after `last`, or none once the API says there are no more. */
export function nextCommentsPage(last: CommentsResponse): number | undefined {
  return last.pagination.hasMore ? last.pagination.page + 1 : undefined
}

/**
 * The pages read so far as one thread. Pages are offsets, so a comment posted
 * between two reads pushes one already shown onto the next page — it is kept
 * once (by id), never twice.
 */
export function flattenCommentPages(data: InfiniteData<CommentsResponse, number>): CommentsThread {
  const seen = new Set<string>()
  const comments: CommentWithAuthor[] = []
  for (const page of data.pages) {
    for (const comment of page.comments) {
      if (seen.has(comment.id)) continue
      seen.add(comment.id)
      comments.push(comment)
    }
  }
  const newest = data.pages[0]
  const oldest = data.pages[data.pages.length - 1]
  return {
    comments,
    pagination: { total: newest?.pagination.total ?? 0, hasMore: oldest?.pagination.hasMore ?? false },
  }
}

/** The thread with one comment taken out of every page it is on (and out of the count). */
export function withoutComment(
  data: InfiniteData<CommentsResponse, number>,
  commentId: string,
): InfiniteData<CommentsResponse, number> {
  if (!data.pages.some((page) => page.comments.some((c) => c.id === commentId))) return data
  return {
    ...data,
    pages: data.pages.map((page) => ({
      ...page,
      comments: page.comments.filter((c) => c.id !== commentId),
      pagination: { ...page.pagination, total: Math.max(0, page.pagination.total - 1) },
    })),
  }
}

/**
 * A list's comments, a page at a time (Community launch plan C1 — "Show
 * older comments"): the first read is the newest {@link COMMENTS_PAGE_SIZE};
 * `fetchNextPage()` reads the next older page while `hasNextPage`. Every
 * caller — the comment boxes and the counts beside them — shares this one
 * read, so a count and the thread under it never disagree.
 */
export function commentsThreadOptions(listId: string | undefined, pageSize = COMMENTS_PAGE_SIZE) {
  return infiniteQueryOptions({
    queryKey: commentsKeys.thread(listId ?? 'none', pageSize),
    enabled: Boolean(listId),
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      fetch(`/api/lists/${listId}/comments?page=${pageParam}&pageSize=${pageSize}`).then(
        jsonOrThrow<CommentsResponse>,
      ),
    getNextPageParam: nextCommentsPage,
    select: flattenCommentPages,
    // As before paging: a box that moves to another list keeps showing the
    // last thread until the new one arrives (`isPlaceholderData` meanwhile).
    placeholderData: keepPreviousData,
  })
}

export function useComments(listId: string | undefined, opts: { pageSize?: number } = {}) {
  return useInfiniteQuery(commentsThreadOptions(listId, opts.pageSize))
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

/**
 * Delete (soft-delete) a comment — `DELETE /api/lists/[id]/comments/[id]`,
 * which since migration 213 goes through `remove_list_comment` (author, list
 * owner or a FieldScout admin). The comment leaves every page of the thread
 * at once and comes back if the server refuses; the refusal is the server's
 * own words (`CommentRequestError`). `useDeleteComment` is this plus
 * `useMutation`; tests drive it through a `MutationObserver`.
 */
export function deleteCommentMutationOptions(qc: QueryClient, listId: string) {
  return {
    mutationFn: (commentId: string) =>
      fetch(`/api/lists/${listId}/comments/${commentId}`, {
        method: 'DELETE',
      }).then(jsonOrThrow<{ ok: boolean }>),

    onMutate: async (commentId: string) => {
      await qc.cancelQueries({ queryKey: commentsKeys.all(listId) })
      const snapshots = qc.getQueriesData<InfiniteData<CommentsResponse, number>>({
        queryKey: commentsKeys.all(listId),
      })
      for (const [key, value] of snapshots) {
        if (!value?.pages) continue
        qc.setQueryData(key, withoutComment(value, commentId))
      }
      return { snapshots }
    },
    onError: (
      _err: Error,
      _vars: string,
      ctx: { snapshots: [QueryKey, InfiniteData<CommentsResponse, number> | undefined][] } | undefined,
    ) => {
      for (const [key, value] of ctx?.snapshots ?? []) {
        qc.setQueryData(key, value)
      }
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: commentsKeys.all(listId) })
    },
  }
}

export function useDeleteComment(listId: string) {
  const qc = useQueryClient()
  return useMutation(deleteCommentMutationOptions(qc, listId))
}
