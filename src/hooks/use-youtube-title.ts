'use client'

import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'

/**
 * A pasted YouTube video's real title, before it is attached (gap list §3 #4)
 * — `GET /api/lists/video-title`, the attach route's own oEmbed lookup.
 *
 * `null` = YouTube gave no title: the row shows no title line ("the real
 * title or nothing", Chris 2026-10-15). A failed request is an error, never a
 * quiet null; the row likewise shows no title, and the attach route looks the
 * title up again when the video is saved.
 *
 * Kept outside the `['lists', …]` keys, and never stale: a video's title is
 * read once a session.
 */
export const youTubeTitleKey = (id: string) => ['youtube-title', id] as const

const responseSchema = z.object({ title: z.string().nullable() })

export async function fetchYouTubeTitle(id: string): Promise<string | null> {
  const res = await fetch(`/api/lists/video-title?id=${encodeURIComponent(id)}`)
  if (!res.ok) throw new Error(`The title lookup failed (HTTP ${res.status}).`)
  return responseSchema.parse(await res.json()).title
}

/** `id`: the video's 11-character id, or null to skip (a stored video
 *  already carries its title). */
export function useYouTubeTitle(id: string | null) {
  return useQuery({
    queryKey: youTubeTitleKey(id ?? ''),
    enabled: Boolean(id),
    staleTime: Infinity,
    retry: false,
    queryFn: () => fetchYouTubeTitle(id as string),
  })
}
