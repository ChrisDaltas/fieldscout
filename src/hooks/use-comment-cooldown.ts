'use client'

import { useCallback, useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import { useAuth } from '@/hooks/use-auth'
import { COMMENT_LIMIT, COMMENT_WINDOW_MS, commentWaitMs, waitSeconds } from '@/lib/rate-limit/comment-limit'
import { createBrowserClient } from '@/lib/supabase/client'

/** The poster's own comments from the last minute — shared by every comment box. */
export const myRecentCommentsKey = (userId: string | undefined) => ['my-recent-comments', userId ?? 'anon'] as const

/**
 * The comment box's pace (Community launch plan C2, migration 213): 5
 * comments a minute per person, across every list.
 *
 * Counts the signed-in poster's own comments from the last minute (one small
 * read, shared by the phone sheet and the desktop tab, made only while a
 * comment box is `active` — open, signed in, comments on) and answers how many
 * seconds Post stays held — ticking down once a second while it is. A
 * refusal the server makes first (its 429's Retry-After) is held too, since
 * the server also counts comments since removed, which the box can no longer
 * read.
 *
 * Before 213 is pushed nothing refuses on the server; the box's own count
 * keeps the same pace. A failed read holds nothing — the server is the
 * authority and its refusal still reaches the poster as a toast.
 */
export function useCommentCooldown({ active = true }: { active?: boolean } = {}) {
  const { user } = useAuth()
  const userId = user?.id
  const qc = useQueryClient()
  const [serverUntil, setServerUntil] = useState<number | null>(null)
  const [now, setNow] = useState(() => Date.now())

  const recent = useQuery({
    queryKey: myRecentCommentsKey(userId),
    enabled: active && Boolean(userId),
    staleTime: 15_000,
    queryFn: async (): Promise<string[]> => {
      const supabase = createBrowserClient()
      const since = new Date(Date.now() - COMMENT_WINDOW_MS).toISOString()
      const { data, error } = await supabase
        .from('list_comments')
        .select('created_at')
        .eq('author_id', userId!)
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(COMMENT_LIMIT * 4)
      if (error) throw error
      return (data ?? []).flatMap((row) => (row.created_at ? [row.created_at] : []))
    },
  })

  // A fresh read is measured against a fresh clock.
  useEffect(() => {
    if (recent.dataUpdatedAt) setNow(Date.now())
  }, [recent.dataUpdatedAt])

  const waitMs = commentWaitMs(recent.data ?? [], now, serverUntil)
  const holding = waitMs > 0

  // Tick once a second while Post is held; stop when the wait is over.
  useEffect(() => {
    if (!holding) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [holding])

  /** A comment landed: count it (its server `created_at`). */
  const notePosted = useCallback(
    (createdAt: string | null | undefined) => {
      setNow(Date.now())
      if (!createdAt) return
      qc.setQueryData<string[]>(myRecentCommentsKey(userId), (prev) => [createdAt, ...(prev ?? [])])
    },
    [qc, userId],
  )

  /** The server refused first: hold Post for its wait. */
  const noteRefused = useCallback((retryAfterSeconds: number) => {
    const at = Date.now()
    setNow(at)
    setServerUntil(at + retryAfterSeconds * 1000)
  }, [])

  return { waitSeconds: waitSeconds(waitMs), notePosted, noteRefused }
}
