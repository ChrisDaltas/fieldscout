'use client'

import { useQuery } from '@tanstack/react-query'

import {
  classifyCommunityList,
  personaScoring,
  scoringLabel,
  type CommunityScoring,
  type RankType,
} from '@/components/mobile/community/community-ops'
import { createBrowserClient } from '@/lib/supabase/client'
import { firstEmbed } from '@/utils/supabase-embed'
import { useListCoverColorSupport } from '@/hooks/use-list-cover-color-support'

/**
 * FieldScout Mobile — Community (handoff m-community). One pool of the most
 * recently active PUBLIC lists — the same rows, RLS surface and persona
 * handling as the desktop feed (`use-explore-feed.ts`) — carrying what the
 * mobile cards draw: the first four players (collage, lead tile, top-three
 * line), video links (badge, YouTube cover), tags (topic pills), the
 * author's follower count, the list's position group and scoring.
 *
 * Which of them are "Rankings" and which "Lists" is `classifyCommunityList`
 * (big boards, weekly boards and AI experts' boards are rankings; people's
 * own lists are lists, ranked or not). Lists with no players aren't in the
 * pool: every account starts with an empty public big board, and an empty
 * list has nothing to explore.
 *
 * Tabs, topics, the inline search and the Rankings chips filter this pool on
 * the client, as the prototype does. Two questions the pool can't answer on
 * its own go to the server: which pool lists contain a given player, and
 * which contain a player whose name matches the search (only four players
 * per list ride along with the pool).
 *
 * The pool is capped. When the read comes back full (`capped`), older public
 * lists are not in it, and the screen says so wherever it filters the pool —
 * a full read is never presented as the whole table.
 */

/** How many lists the feed holds. A cap on the pool, not a page size. */
export const COMMUNITY_POOL_SIZE = 100

export interface CommunityPool {
  items: CommunityItem[]
  /** The read hit COMMUNITY_POOL_SIZE: there may be older public lists. */
  capped: boolean
}

export interface CommunityPlayer {
  id: string
  full_name: string
  position: string | null
  team: string | null
  headshot_url: string | null
}

export interface CommunityVideo {
  url: string
  title: string
  duration: string | null
  source: string | null
}

export interface CommunityAuthor {
  /** Profile id — null for an AI persona's board (not a followable person). */
  profileId: string | null
  /** The handle without the "@". */
  username: string
  avatarUrl: string | null
  /** Followers of a person; null for a persona (no follow graph). */
  followers: number | null
  isPersona: boolean
}

export interface CommunityItem {
  id: string
  title: string
  slug: string
  description: string | null
  kind: 'rank' | 'list'
  /** Weekly board / pre-draft big board; null for other rankings. */
  rankType: RankType | null
  positionFilter: string | null
  /** The owner's chosen cover colour key (migration 188), else null — the
   *  cover then follows the position colour. */
  coverColor?: string | null
  /** From the list's scoring system, else an AI expert's default; null when
   *  neither is known (or the scoring system isn't readable). */
  scoring: CommunityScoring | null
  playerCount: number
  createdAt: string
  updatedAt: string
  thumbnailUrl: string | null
  /** The list owner's username — the public URL lives under it, persona
   *  boards included. */
  ownerUsername: string
  author: CommunityAuthor
  /** First four players in list order. */
  heads: CommunityPlayer[]
  tags: { id: string; name: string; slug: string }[]
  videos: CommunityVideo[]
}

interface Row {
  id: string
  title: string
  /** Present only once migration 188 is pushed (selected conditionally). */
  cover_color?: string | null
  slug: string
  description: string | null
  is_big_board: boolean | null
  position_filter: string | null
  player_count: number | null
  created_at: string | null
  updated_at: string | null
  thumbnail_url: string | null
  ai_persona_id: string | null
  owner: OwnerRow | OwnerRow[] | null
  persona: PersonaRow | PersonaRow[] | null
  scoring: { rules: unknown } | { rules: unknown }[] | null
  tag_links: { tag: TagRow | TagRow[] | null }[] | null
  links: LinkRow[] | null
  heads: { position: number; player: CommunityPlayer | CommunityPlayer[] | null }[] | null
}
interface OwnerRow {
  id: string
  username: string
  avatar_url: string | null
  follower_count: number | null
}
interface PersonaRow {
  username: string
  avatar_url: string | null
  scoring: string | null
}
interface TagRow {
  id: string
  name: string
  slug: string
}
interface LinkRow {
  kind: string
  url: string
  title: string
  duration_label: string | null
  source_label: string | null
  position: number
}

const POOL_SELECT = `id, title, slug, description, is_big_board, position_filter, player_count,
  created_at, updated_at, thumbnail_url, ai_persona_id,
  owner:profiles!lists_owner_id_fkey(id, username, avatar_url, follower_count),
  persona:ai_personas!lists_ai_persona_id_fkey(username, avatar_url, scoring:style_profile->>scoring_default),
  scoring:scoring_systems!lists_scoring_system_id_fkey(rules),
  tag_links:list_tags(tag:tags(id, name, slug)),
  links:list_links(kind, url, title, duration_label, source_label, position),
  heads:list_players(position, player:players(id, full_name, position, team, headshot_url))`

export function mapCommunityRows(rows: Row[]): CommunityItem[] {
  return rows.flatMap((row) => {
    const owner = firstEmbed(row.owner)
    if (!owner) return []
    const persona = row.ai_persona_id ? firstEmbed(row.persona) : null
    const heads = (row.heads ?? [])
      .slice()
      .sort((a, b) => a.position - b.position)
      .flatMap((h) => {
        const p = firstEmbed(h.player)
        return p ? [p] : []
      })
      .slice(0, 4)
    const videos = (row.links ?? [])
      .filter((l) => l.kind === 'video')
      .sort((a, b) => a.position - b.position)
      .map((l) => ({ url: l.url, title: l.title, duration: l.duration_label, source: l.source_label }))
    const { kind, rankType } = classifyCommunityList(row)
    return [
      {
        id: row.id,
        title: row.title,
        slug: row.slug,
        description: row.description,
        kind,
        rankType,
        positionFilter: row.position_filter,
        coverColor: row.cover_color ?? null,
        scoring: scoringLabel(firstEmbed(row.scoring)?.rules ?? null) ?? personaScoring(persona?.scoring ?? null),
        playerCount: row.player_count ?? 0,
        createdAt: row.created_at ?? '',
        updatedAt: row.updated_at ?? row.created_at ?? '',
        thumbnailUrl: row.thumbnail_url,
        ownerUsername: owner.username,
        author: persona
          ? { profileId: null, username: persona.username, avatarUrl: persona.avatar_url, followers: null, isPersona: true }
          : {
              profileId: owner.id,
              username: owner.username,
              avatarUrl: owner.avatar_url,
              followers: owner.follower_count ?? 0,
              isPersona: false,
            },
        heads,
        tags: (row.tag_links ?? []).flatMap((t) => {
          const tag = firstEmbed(t.tag)
          return tag ? [tag] : []
        }),
        videos,
      } satisfies CommunityItem,
    ]
  })
}

export const mobileCommunityKeys = {
  all: ['mobile-community'] as const,
  pool: () => ['mobile-community', 'pool'] as const,
  playerMatch: (poolIds: string[], playerId: string | null, query: string) =>
    ['mobile-community', 'player-match', playerId ?? '', query, poolIds] as const,
}

/** The Community pool: most recently active public lists and rankings. */
export function useMobileCommunityFeed() {
  // The cover colour column (migration 188) is named only once it exists —
  // naming it before the push would fail the whole read.
  const colours = useListCoverColorSupport()
  const withColour = colours.data === true
  return useQuery({
    queryKey: [...mobileCommunityKeys.pool(), withColour ? 'colour' : 'plain'],
    enabled: !colours.isPending,
    staleTime: 60 * 1000,
    queryFn: async (): Promise<CommunityPool> => {
      const supabase = createBrowserClient()
      const { data, error } = await supabase
        .from('lists')
        .select(withColour ? `${POOL_SELECT}, cover_color` : POOL_SELECT)
        .eq('is_private', false)
        .is('deleted_at', null)
        .gt('player_count', 0)
        .order('updated_at', { ascending: false, nullsFirst: false })
        // Per-list caps on the embeds (PostgREST applies these per parent).
        .order('position', { referencedTable: 'heads', ascending: true })
        .limit(4, { referencedTable: 'heads' })
        .limit(COMMUNITY_POOL_SIZE)
      if (error) throw error
      const rows = (data ?? []) as unknown as Row[]
      return { items: mapCommunityRows(rows), capped: rows.length >= COMMUNITY_POOL_SIZE }
    },
  })
}

/** Escape LIKE wildcards so a typed "%" or "_" matches itself. */
function likePattern(q: string): string {
  return `%${q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`
}

/**
 * Which pool lists contain a player — by id (a player topic pill) or by a
 * name fragment (the inline search). Undefined while there is nothing to ask.
 */
export function useCommunityPlayerMatches(
  poolIds: string[],
  opts: { playerId?: string | null; query?: string },
) {
  const playerId = opts.playerId ?? null
  const query = (opts.query ?? '').trim()
  const enabled = poolIds.length > 0 && (playerId !== null || query.length >= 2)
  return useQuery({
    queryKey: mobileCommunityKeys.playerMatch(poolIds, playerId, playerId ? '' : query),
    enabled,
    staleTime: 60 * 1000,
    queryFn: async (): Promise<Set<string>> => {
      const supabase = createBrowserClient()
      if (playerId) {
        const { data, error } = await supabase
          .from('list_players')
          .select('list_id')
          .in('list_id', poolIds)
          .eq('player_id', playerId)
        if (error) throw error
        return new Set((data ?? []).map((r) => r.list_id as string))
      }
      // Asked from the list side so the answer is at most one row per pool
      // list: the inner joins keep only lists with a matching player, and the
      // embed is capped at one row. (Asking list_players directly could run
      // past PostgREST's 1000-row cap on a short fragment and silently drop
      // lists.) Each player appears once per list, so the id lookup above is
      // bounded by the pool too.
      const { data, error } = await supabase
        .from('lists')
        .select('id, lp:list_players!inner(player:players!inner(full_name))')
        .in('id', poolIds)
        .ilike('lp.player.full_name', likePattern(query))
        .limit(1, { referencedTable: 'lp' })
      if (error) throw error
      return new Set(((data ?? []) as unknown as { id: string }[]).map((r) => r.id))
    },
  })
}
