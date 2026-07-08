'use client'

import { useQuery } from '@tanstack/react-query'

import { createBrowserClient } from '@/lib/supabase/client'

// Community feed (package screen 08). No dedicated feed API exists yet, so
// this hook reads public lists directly through the browser Supabase client —
// same pattern (and RLS surface) as use-persona-boards. Trending = most
// liked, Newest = most recent, Following = lists by people the viewer
// follows (real `follows` rows).

export type ExploreFeedTab = 'trending' | 'newest' | 'following'

export interface ExploreFeedItem {
  id: string
  title: string
  slug: string
  /** ranking_mode !== 'unranked' → "Ranking" badge, else "List". */
  is_ranking: boolean
  /** Persona-authored content keeps its AI badge treatment. */
  is_ai: boolean
  like_count: number
  comment_count: number
  player_count: number
  created_at: string
  /** Display identity: the persona for AI boards, else the owner profile. */
  author: {
    name: string
    handle: string
    avatar_url: string | null
  }
  /** Public list page (persona boards also live under the owner profile). */
  href: string
  author_href: string
  tag: { name: string; slug: string } | null
}

interface EmbeddedProfile {
  username: string
  display_name: string | null
  avatar_url: string | null
}

interface EmbeddedPersona {
  username: string
  display_name: string
  avatar_url: string | null
}

interface FeedRowShape {
  id: string
  title: string
  slug: string
  ranking_mode: string
  ai_persona_id: string | null
  like_count: number | null
  player_count: number | null
  created_at: string | null
  owner: EmbeddedProfile | EmbeddedProfile[] | null
  persona: EmbeddedPersona | EmbeddedPersona[] | null
  comments: { count: number }[] | null
  tag_links:
    | { tag: { name: string; slug: string } | { name: string; slug: string }[] | null }[]
    | null
}

function first<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null
  return Array.isArray(value) ? (value[0] ?? null) : value
}

const FEED_SELECT = `id, title, slug, ranking_mode, ai_persona_id, like_count, player_count, created_at,
  owner:profiles!lists_owner_id_fkey(username, display_name, avatar_url),
  persona:ai_personas!lists_ai_persona_id_fkey(username, display_name, avatar_url),
  comments:list_comments(count),
  tag_links:list_tags(tag:tags(name, slug))`

const FEED_LIMIT = 30

function mapRows(rows: FeedRowShape[]): ExploreFeedItem[] {
  return rows.flatMap((row) => {
    const owner = first(row.owner)
    if (!owner) return []
    const persona = row.ai_persona_id ? first(row.persona) : null

    return [
      {
        id: row.id,
        title: row.title,
        slug: row.slug,
        is_ranking: row.ranking_mode !== 'unranked',
        is_ai: Boolean(persona),
        like_count: row.like_count ?? 0,
        comment_count: row.comments?.[0]?.count ?? 0,
        player_count: row.player_count ?? 0,
        created_at: row.created_at ?? '',
        author: persona
          ? {
              name: persona.display_name,
              handle: persona.username,
              avatar_url: persona.avatar_url,
            }
          : {
              name: owner.display_name ?? owner.username,
              handle: owner.username,
              avatar_url: owner.avatar_url,
            },
        href: `/u/${owner.username}/lists/${row.slug}`,
        author_href: persona
          ? `/personas/${persona.username}`
          : `/u/${owner.username}`,
        tag: first(row.tag_links?.[0]?.tag ?? null),
      },
    ]
  })
}

export const exploreFeedKeys = {
  all: ['explore-feed'] as const,
  feed: (tab: ExploreFeedTab, tagId: string | null) =>
    ['explore-feed', tab, tagId ?? 'all'] as const,
}

export function useExploreFeed(tab: ExploreFeedTab, tagId: string | null) {
  return useQuery({
    queryKey: exploreFeedKeys.feed(tab, tagId),
    staleTime: 60 * 1000,
    queryFn: async (): Promise<ExploreFeedItem[]> => {
      const supabase = createBrowserClient()

      // Following reads the viewer's real follows; empty follows → empty feed.
      let ownerIds: string[] | null = null
      if (tab === 'following') {
        const {
          data: { user },
        } = await supabase.auth.getUser()
        if (!user) return []
        const { data: follows, error: followsError } = await supabase
          .from('follows')
          .select('following_id')
          .eq('follower_id', user.id)
        if (followsError) throw followsError
        ownerIds = (follows ?? []).map((f) => f.following_id)
        if (ownerIds.length === 0) return []
      }

      // The tag chip filter needs an inner join alias distinct from the
      // display embed, so untagged lists still surface on "All".
      const select = tagId
        ? `${FEED_SELECT},\n  tag_filter:list_tags!inner(tag_id)`
        : FEED_SELECT

      let query = supabase
        .from('lists')
        .select(select)
        .eq('is_private', false)
        .is('deleted_at', null)
        .limit(FEED_LIMIT)

      if (tagId) query = query.eq('tag_filter.tag_id', tagId)
      if (ownerIds) query = query.in('owner_id', ownerIds)

      query =
        tab === 'trending'
          ? query
              .order('like_count', { ascending: false })
              .order('updated_at', { ascending: false })
          : query.order('created_at', { ascending: false })

      const { data, error } = await query
      if (error) throw error

      return mapRows((data ?? []) as unknown as FeedRowShape[])
    },
  })
}
