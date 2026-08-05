import { useQuery } from '@tanstack/react-query'

/**
 * The signed-in user's remaining AI generations for the current UTC day
 * (GET /api/lists/generate). Purely informational — the POST route is the
 * enforcement point; this just lets the modal say "2 of 3 left today" instead
 * of letting someone spend a click to find out.
 */

export interface AiGenerationQuota {
  limit: number
  used: number
  remaining: number
  /** ISO timestamp of the next UTC day boundary. */
  resets_at: string
}

export const aiQuotaKeys = {
  all: ['ai-generation-quota'] as const,
}

export function useAiGenerationQuota(enabled = true) {
  return useQuery({
    queryKey: aiQuotaKeys.all,
    enabled,
    // The count only moves when this user generates, and every generation
    // invalidates the key — so a short stale window is plenty.
    staleTime: 30 * 1000,
    queryFn: async (): Promise<AiGenerationQuota> => {
      const res = await fetch('/api/lists/generate')
      if (!res.ok) throw new Error('Could not read your AI generation quota.')
      return (await res.json()) as AiGenerationQuota
    },
  })
}
