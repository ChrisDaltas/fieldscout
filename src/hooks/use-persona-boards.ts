'use client'

import { useQuery } from '@tanstack/react-query'

import { createBrowserClient } from '@/lib/supabase/client'

export interface PersonaBoard {
  id: string
  title: string
  slug: string
  description: string | null
  position_filter: string | null
  player_count: number
  updated_at: string
  persona: {
    username: string
    display_name: string
    avatar_url: string | null
  }
  owner: {
    username: string
  }
}

interface PersonaBoardRow {
  id: string
  title: string
  slug: string
  description: string | null
  position_filter: string | null
  player_count: number | null
  updated_at: string | null
  persona:
    | { username: string; display_name: string; avatar_url: string | null; is_active: boolean | null }
    | { username: string; display_name: string; avatar_url: string | null; is_active: boolean | null }[]
    | null
  owner: { username: string } | { username: string }[] | null
}

function first<T>(value: T | T[] | null): T | null {
  if (value == null) return null
  return Array.isArray(value) ? (value[0] ?? null) : value
}

/** Latest public persona-owned boards for the home "From the AI Experts"
 * shelf. Personas and their public lists are anon-readable under RLS. */
export function usePersonaBoards(limit = 9) {
  return useQuery({
    queryKey: ['persona-boards', limit],
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<PersonaBoard[]> => {
      const supabase = createBrowserClient()
      const { data, error } = await supabase
        .from('lists')
        .select(
          `id, title, slug, description, position_filter, player_count, updated_at,
           persona:ai_personas!lists_ai_persona_id_fkey!inner(username, display_name, avatar_url, is_active),
           owner:profiles!lists_owner_id_fkey(username)`,
        )
        .not('ai_persona_id', 'is', null)
        .eq('is_private', false)
        .is('deleted_at', null)
        .eq('ai_personas.is_active', true)
        .order('updated_at', { ascending: false })
        .limit(limit)
      if (error) throw error

      return ((data ?? []) as unknown as PersonaBoardRow[]).flatMap((row) => {
        const persona = first(row.persona)
        const owner = first(row.owner)
        if (!persona || !owner) return []
        return [
          {
            id: row.id,
            title: row.title,
            slug: row.slug,
            description: row.description,
            position_filter: row.position_filter,
            player_count: row.player_count ?? 0,
            updated_at: row.updated_at ?? '',
            persona: {
              username: persona.username,
              display_name: persona.display_name,
              avatar_url: persona.avatar_url,
            },
            owner: { username: owner.username },
          },
        ]
      })
    },
  })
}

// ============================================================================
// Published persona posts for the same shelf (M5 — content engine).
// ============================================================================

export interface PersonaPostCard {
  id: string
  title: string
  slug: string
  dek: string | null
  published_at: string | null
  persona: {
    username: string
    display_name: string
    avatar_url: string | null
  }
}

interface PersonaPostRow {
  id: string
  title: string
  slug: string
  dek: string | null
  published_at: string | null
  persona:
    | { username: string; display_name: string; avatar_url: string | null }
    | { username: string; display_name: string; avatar_url: string | null }[]
    | null
}

/** Latest published persona posts. RLS exposes only published, non-deleted
 * rows to anon reads, so no status filter is needed client-side. */
export function usePersonaPosts(limit = 6) {
  return useQuery({
    queryKey: ['persona-posts', limit],
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<PersonaPostCard[]> => {
      const supabase = createBrowserClient()
      const { data, error } = await supabase
        .from('persona_posts')
        .select(
          `id, title, slug, dek, published_at,
           persona:ai_personas!persona_posts_ai_persona_id_fkey!inner(username, display_name, avatar_url, is_active)`,
        )
        .eq('ai_personas.is_active', true)
        .order('published_at', { ascending: false })
        .limit(limit)
      if (error) throw error

      return ((data ?? []) as unknown as PersonaPostRow[]).flatMap((row) => {
        const persona = first(row.persona)
        if (!persona) return []
        return [
          {
            id: row.id,
            title: row.title,
            slug: row.slug,
            dek: row.dek,
            published_at: row.published_at,
            persona,
          },
        ]
      })
    },
  })
}
