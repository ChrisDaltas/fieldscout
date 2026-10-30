'use client'

import { useQuery } from '@tanstack/react-query'

import { personaScoring, scoringLabel, type CommunityScoring } from '@/components/mobile/community/community-ops'
import type { CommunityAuthor } from '@/hooks/use-mobile-community-feed'
import { createBrowserClient } from '@/lib/supabase/client'

/**
 * FieldScout Mobile — Community list detail (handoff m-community §2.14). The
 * list itself comes from the shared `useList` (`/api/lists/[id]`: players,
 * links, the viewer's saved state, ownership). That route doesn't name the
 * author, so this reads who made it — the owner profile (handle, avatar,
 * follower count) or, for an AI persona's board, the persona — plus the
 * list's scoring for the "Ranking · PPR" kind pill (its scoring system, else
 * the AI expert's default).
 */
export interface CommunityListMeta {
  ownerUsername: string
  /** The owner profile's own picture — the desktop byline's (plan C5),
   *  which names the owner even on an AI expert's board, as the share page
   *  does. */
  ownerAvatarUrl: string | null
  author: CommunityAuthor
  scoring: CommunityScoring | null
}

/** Every list page's "who made it" read (`useMobileCommunityListMeta`). */
export const COMMUNITY_LIST_META_KEY = ['mobile-community', 'list-meta'] as const

/**
 * A follow (+1) or unfollow (−1) of `targetId`, on a list page's author line:
 * "@devpro · 0 follows" reads 1 at the tap when @devpro made the list (never
 * below 0). Any other author — and an AI expert, who has no follow count —
 * is left as it was.
 */
export function withAuthorFollowerChange(
  meta: CommunityListMeta | undefined,
  targetId: string,
  delta: 1 | -1,
): CommunityListMeta | undefined {
  if (!meta || meta.author.profileId !== targetId || meta.author.followers === null) return meta
  return { ...meta, author: { ...meta.author, followers: Math.max(0, meta.author.followers + delta) } }
}

export function useMobileCommunityListMeta(list: {
  owner_id: string
  ai_persona_id: string | null
  scoring_system_id: string | null
} | null | undefined) {
  const ownerId = list?.owner_id
  const personaId = list?.ai_persona_id ?? null
  const scoringId = list?.scoring_system_id ?? null
  return useQuery({
    queryKey: [...COMMUNITY_LIST_META_KEY, ownerId ?? '', personaId ?? '', scoringId ?? ''],
    enabled: Boolean(ownerId),
    staleTime: 60 * 1000,
    queryFn: async (): Promise<CommunityListMeta> => {
      const supabase = createBrowserClient()
      const [ownerRes, personaRes, scoringRes] = await Promise.all([
        supabase.from('profiles').select('id, username, avatar_url, follower_count').eq('id', ownerId!).maybeSingle(),
        personaId
          ? supabase
              .from('ai_personas')
              .select('username, avatar_url, scoring:style_profile->>scoring_default')
              .eq('id', personaId)
              .maybeSingle()
          : Promise.resolve({ data: null, error: null }),
        scoringId
          ? supabase.from('scoring_systems').select('rules').eq('id', scoringId).maybeSingle()
          : Promise.resolve({ data: null, error: null }),
      ])
      if (ownerRes.error) throw ownerRes.error
      if (personaRes.error) throw personaRes.error
      if (scoringRes.error) throw scoringRes.error
      // A readable list always has a readable owner profile (profiles are
      // public) — a missing one is a real fault, not an empty author.
      const owner = ownerRes.data
      if (!owner) throw new Error('List owner not found')
      const persona = personaRes.data as { username: string; avatar_url: string | null; scoring: string | null } | null
      return {
        ownerUsername: owner.username,
        ownerAvatarUrl: owner.avatar_url,
        author: persona
          ? { profileId: null, username: persona.username, avatarUrl: persona.avatar_url, followers: null, isPersona: true }
          : {
              profileId: owner.id,
              username: owner.username,
              avatarUrl: owner.avatar_url,
              followers: owner.follower_count ?? 0,
              isPersona: false,
            },
        // Another user's custom scoring system isn't readable (RLS) — then
        // the pill just says "Ranking".
        scoring:
          scoringLabel((scoringRes.data as { rules: unknown } | null)?.rules ?? null) ??
          personaScoring(persona?.scoring ?? null),
      }
    },
  })
}
