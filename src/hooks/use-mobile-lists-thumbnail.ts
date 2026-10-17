'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'

import { listsKeys } from '@/hooks/use-lists'

/**
 * FieldScout Mobile — Lists: upload a list's cover image through the existing
 * `POST /api/lists/[id]/thumbnail` (5MB; png, jpeg, webp, gif; owner only).
 * The route answers every refusal with a message, which the caller shows.
 */
export const THUMBNAIL_MAX_BYTES = 5 * 1024 * 1024
export const THUMBNAIL_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif'] as const

/** Why this file can't be a cover, or null when it can. */
export function thumbnailProblem(file: File): string | null {
  if (!(THUMBNAIL_TYPES as readonly string[]).includes(file.type)) return 'Use a PNG, JPEG, WebP or GIF image.'
  if (file.size > THUMBNAIL_MAX_BYTES) return 'That image is over 5MB.'
  return null
}

export function useMobileListsThumbnail() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ listId, file }: { listId: string; file: File }) => {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch(`/api/lists/${listId}/thumbnail`, { method: 'POST', body: form })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? `Upload failed with ${res.status}`)
      }
      return (await res.json()) as unknown
    },
    onSettled: (_data, _error, { listId }) => {
      qc.invalidateQueries({ queryKey: listsKeys.detail(listId) })
      qc.invalidateQueries({ queryKey: listsKeys.collections() })
    },
  })
}
